import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, desc } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import {
  createClipRequestSchema,
  updateClipRequestSchema,
  exportClipRequestSchema,
  MAX_CLIP_SECONDS,
  type ClipDto,
  type ClipPreview,
} from '@free-wan/shared'
import { clips, mediaItems, type ClipRow } from '../db/schema'
import { enqueueJob } from '../services/jobs'
import { emitPluginEvent } from '../services/plugin-events'

const validationError = { error: { code: 'validation_error', message: 'Invalid input' } }
const notFound = { error: { code: 'not_found', message: 'Clip not found' } }

function sourceState(app: FastifyInstance, sourceItemId: string | null) {
  const src = sourceItemId
    ? app.db.select({ id: mediaItems.id, status: mediaItems.status }).from(mediaItems).where(eq(mediaItems.id, sourceItemId)).get()
    : undefined
  return { src, orphaned: !sourceItemId || !src || src.status !== 'active' }
}

function toDto(app: FastifyInstance, c: ClipRow): ClipDto {
  const { orphaned } = sourceState(app, c.sourceItemId)
  return {
    id: c.id,
    name: c.name,
    sourceItemId: c.sourceItemId,
    startS: c.startS,
    endS: c.endS,
    durationS: c.endS - c.startS,
    loop: Boolean(c.loop),
    orphaned,
    posterUrl: c.sourceItemId && !orphaned ? `/api/media/${c.sourceItemId}/poster` : null,
    previewUrl: `/api/clips/${c.id}/preview`,
    exportStatus: c.exportStatus,
    exportUrl: c.exportStatus === 'ready' ? `/api/clips/${c.id}/download` : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

function owned(app: FastifyInstance, id: string, userId: string): ClipRow | undefined {
  return app.db.select().from(clips).where(and(eq(clips.id, id), eq(clips.userId, userId))).get()
}

export async function clipRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  app.get('/api/clips', async (req) => {
    const rows = app.db.select().from(clips).where(eq(clips.userId, req.user!.id)).orderBy(desc(clips.createdAt)).all()
    return { data: rows.map((c) => toDto(app, c)) }
  })

  app.post('/api/clips', async (req, reply) => {
    const parsed = createClipRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { sourceItemId, name, startS, endS, loop } = parsed.data
    const src = app.db.select().from(mediaItems).where(eq(mediaItems.id, sourceItemId)).get()
    if (!src || src.type !== 'video') {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Source video not found' } })
    }

    const now = Date.now()
    const id = uuidv7()
    app.db
      .insert(clips)
      .values({
        id,
        userId: req.user!.id,
        sourceItemId,
        name,
        startS,
        endS,
        loop: loop === false ? 0 : 1,
        posterPath: null,
        exportPath: null,
        exportStatus: 'none',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    emitPluginEvent(app, 'clip.created', { clipId: id, sourceItemId, name })
    return reply.code(201).send(toDto(app, owned(app, id, req.user!.id)!))
  })

  app.get('/api/clips/:id', async (req, reply) => {
    const c = owned(app, (req.params as { id: string }).id, req.user!.id)
    if (!c) return reply.code(404).send(notFound)
    return toDto(app, c)
  })

  app.patch('/api/clips/:id', async (req, reply) => {
    const parsed = updateClipRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const c = owned(app, (req.params as { id: string }).id, req.user!.id)
    if (!c) return reply.code(404).send(notFound)

    const startS = parsed.data.startS ?? c.startS
    const endS = parsed.data.endS ?? c.endS
    if (endS <= startS || endS - startS > MAX_CLIP_SECONDS) return reply.code(422).send(validationError)

    const patch: Partial<ClipRow> = { startS, endS, updatedAt: Date.now() }
    if (parsed.data.name !== undefined) patch.name = parsed.data.name
    if (parsed.data.loop !== undefined) patch.loop = parsed.data.loop ? 1 : 0
    app.db.update(clips).set(patch).where(eq(clips.id, c.id)).run()
    return toDto(app, owned(app, c.id, req.user!.id)!)
  })

  app.delete('/api/clips/:id', async (req, reply) => {
    const c = owned(app, (req.params as { id: string }).id, req.user!.id)
    if (!c) return reply.code(404).send(notFound)
    app.db.delete(clips).where(eq(clips.id, c.id)).run()
    return reply.code(204).send()
  })

  // Virtual loop: the client plays the source between start/end (no render).
  app.get('/api/clips/:id/preview', async (req, reply) => {
    const c = owned(app, (req.params as { id: string }).id, req.user!.id)
    if (!c) return reply.code(404).send(notFound)
    const { orphaned } = sourceState(app, c.sourceItemId)
    const preview: ClipPreview = {
      sourceUrl: c.sourceItemId ? `/api/media/${c.sourceItemId}/stream` : '',
      startS: c.startS,
      endS: c.endS,
      loop: Boolean(c.loop),
      orphaned,
    }
    return preview
  })

  app.post('/api/clips/:id/export', async (req, reply) => {
    const parsed = exportClipRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const c = owned(app, (req.params as { id: string }).id, req.user!.id)
    if (!c) return reply.code(404).send(notFound)
    const { orphaned } = sourceState(app, c.sourceItemId)
    if (orphaned) return reply.code(409).send({ error: { code: 'conflict', message: 'Source is unavailable' } })

    app.db.update(clips).set({ exportStatus: 'queued', updatedAt: Date.now() }).where(eq(clips.id, c.id)).run()
    const jobId = enqueueJob(app.db, 'clip_export', { clipId: c.id, format: parsed.data.format }, 5)
    app.worker.kick()
    return reply.code(202).send({ jobId })
  })

  app.get('/api/clips/:id/export', async (req, reply) => {
    const c = owned(app, (req.params as { id: string }).id, req.user!.id)
    if (!c) return reply.code(404).send(notFound)
    return {
      status: c.exportStatus,
      downloadUrl: c.exportStatus === 'ready' ? `/api/clips/${c.id}/download` : null,
    }
  })

  app.get('/api/clips/:id/download', async (req, reply) => {
    const c = owned(app, (req.params as { id: string }).id, req.user!.id)
    if (!c || c.exportStatus !== 'ready' || !c.exportPath) return reply.code(404).send(notFound)
    const abs = join(app.config.dataDir, c.exportPath)
    if (!existsSync(abs)) return reply.code(404).send(notFound)
    reply.type(c.exportPath.endsWith('.gif') ? 'image/gif' : 'video/mp4')
    reply.header('Content-Disposition', `attachment; filename="${c.name}.${c.exportPath.endsWith('.gif') ? 'gif' : 'mp4'}"`)
    return reply.send(createReadStream(abs))
  })
}
