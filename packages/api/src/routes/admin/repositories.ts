import { existsSync, statSync } from 'node:fs'
import { and, eq, count, desc, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import {
  createRepositoryRequestSchema,
  updateRepositoryRequestSchema,
  scanRequestSchema,
  type RepositoryDto,
} from '@free-wan/shared'
import { repositories, mediaItems, jobs, type RepositoryRow } from '../../db/schema'
import { enqueueJob } from '../../services/jobs'

const validationError = { error: { code: 'validation_error', message: 'Invalid input' } }
const notFound = { error: { code: 'not_found', message: 'Repository not found' } }

function activeItemCount(app: FastifyInstance, repoId: string): number {
  const row = app.db
    .select({ n: count() })
    .from(mediaItems)
    .where(and(eq(mediaItems.repositoryId, repoId), eq(mediaItems.status, 'active')))
    .get()
  return row?.n ?? 0
}

function toDto(app: FastifyInstance, r: RepositoryRow): RepositoryDto {
  return {
    id: r.id,
    name: r.name,
    rootPath: r.rootPath,
    type: r.type,
    enabled: Boolean(r.enabled),
    readOnly: Boolean(r.readOnly),
    status: r.status,
    lastScanAt: r.lastScanAt,
    lastError: r.lastError,
    itemCount: activeItemCount(app, r.id),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export async function adminRepositoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAdmin)

  app.get('/api/admin/repositories', async () => {
    const rows = app.db.select().from(repositories).all()
    return { data: rows.map((r) => toDto(app, r)) }
  })

  app.post('/api/admin/repositories', async (req, reply) => {
    const parsed = createRepositoryRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { name, rootPath, type, readOnly } = parsed.data

    if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
      return reply
        .code(422)
        .send({ error: { code: 'validation_error', message: 'rootPath does not exist or is not a directory' } })
    }

    const now = Date.now()
    const id = uuidv7()
    app.db
      .insert(repositories)
      .values({
        id,
        name,
        rootPath,
        type,
        enabled: 1,
        readOnly: readOnly === false ? 0 : 1,
        status: 'unknown',
        lastScanAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const row = app.db.select().from(repositories).where(eq(repositories.id, id)).get()!
    app.watchers.sync()
    return reply.code(201).send(toDto(app, row))
  })

  app.patch('/api/admin/repositories/:id', async (req, reply) => {
    const parsed = updateRepositoryRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    const target = app.db.select().from(repositories).where(eq(repositories.id, id)).get()
    if (!target) return reply.code(404).send(notFound)

    const patch: Partial<RepositoryRow> = { updatedAt: Date.now() }
    if (parsed.data.name !== undefined) patch.name = parsed.data.name
    if (parsed.data.type !== undefined) patch.type = parsed.data.type
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled ? 1 : 0
    if (parsed.data.readOnly !== undefined) patch.readOnly = parsed.data.readOnly ? 1 : 0
    app.db.update(repositories).set(patch).where(eq(repositories.id, id)).run()
    const row = app.db.select().from(repositories).where(eq(repositories.id, id)).get()!
    app.watchers.sync()
    return reply.send(toDto(app, row))
  })

  app.delete('/api/admin/repositories/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const target = app.db.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, id)).get()
    if (!target) return reply.code(404).send(notFound)
    // Index rows cascade (media_items → categories/links/subs). Source files are untouched.
    app.db.delete(repositories).where(eq(repositories.id, id)).run()
    app.watchers.sync()
    return reply.code(204).send()
  })

  app.post('/api/admin/repositories/:id/scan', async (req, reply) => {
    const parsed = scanRequestSchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    const target = app.db.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, id)).get()
    if (!target) return reply.code(404).send(notFound)

    const jobId = enqueueJob(app.db, 'scan', { repositoryId: id, full: parsed.data.full ?? false }, 10)
    app.worker.kick()
    return reply.code(202).send({ jobId })
  })

  app.get('/api/admin/repositories/:id/scan', async (req, reply) => {
    const { id } = req.params as { id: string }
    const job = app.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, 'scan'), sql`json_extract(${jobs.payload}, '$.repositoryId') = ${id}`))
      .orderBy(desc(jobs.createdAt))
      .limit(1)
      .get()
    if (!job) return reply.code(404).send({ error: { code: 'not_found', message: 'No scan has run yet' } })

    let result: { found?: number; indexed?: number; failed?: number; removed?: number } = {}
    try {
      result = (JSON.parse(job.payload) as { result?: typeof result }).result ?? {}
    } catch {
      /* ignore malformed payload */
    }
    return reply.send({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      ...result,
    })
  })
}
