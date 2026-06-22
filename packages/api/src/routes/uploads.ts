import { existsSync, mkdirSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { repositories } from '../db/schema'
import { enqueueJob } from '../services/jobs'
import { IMAGE_EXTS, extOf } from '../lib/media-types'

/** Where uploaded photos land inside the target repo (also becomes their category). */
const UPLOAD_SUBDIR = 'Uploads'
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_FILES = 50

// mimetype → canonical extension. Falls back to the file's own extension if it's a known image.
const IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heic',
}

function safeStem(filename: string): string {
  const stem = filename
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w .-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return stem || 'photo'
}

/** A non-colliding "<stem>.<ext>" (or "<stem> (n).<ext>") inside dir. */
function uniqueName(dir: string, stem: string, ext: string): string {
  let candidate = `${stem}.${ext}`
  let n = 1
  while (existsSync(join(dir, candidate))) candidate = `${stem} (${n++}).${ext}`
  return candidate
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  // Repositories a user may upload photos into: writable and image-capable.
  app.get('/api/upload/targets', async () => {
    const rows = app.db
      .select()
      .from(repositories)
      .where(and(eq(repositories.readOnly, 0), inArray(repositories.type, ['image', 'mixed'])))
      .all()
    return { data: rows.filter((r) => r.enabled).map((r) => ({ id: r.id, name: r.name, type: r.type })) }
  })

  app.post('/api/repositories/:id/upload', async (req, reply) => {
    const { id } = req.params as { id: string }
    const repo = app.db.select().from(repositories).where(eq(repositories.id, id)).get()
    if (!repo) return reply.code(404).send({ error: { code: 'not_found', message: 'Repository not found' } })
    if (repo.readOnly) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Repository is read-only' } })
    }
    if (repo.type !== 'image' && repo.type !== 'mixed') {
      return reply
        .code(422)
        .send({ error: { code: 'validation_error', message: 'Repository does not accept images' } })
    }
    if (!existsSync(repo.rootPath) || !statSync(repo.rootPath).isDirectory()) {
      return reply.code(409).send({ error: { code: 'offline', message: 'Repository folder is unavailable' } })
    }

    const dir = join(repo.rootPath, UPLOAD_SUBDIR)
    const uploaded: string[] = []
    const skipped: Array<{ name: string; reason: string }> = []

    let parts
    try {
      parts = req.files({ limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES } })
    } catch {
      return reply.code(415).send({ error: { code: 'validation_error', message: 'Expected a multipart upload' } })
    }

    for await (const part of parts) {
      const ext = IMAGE_MIME[part.mimetype] ?? (IMAGE_EXTS.has(extOf(part.filename)) ? extOf(part.filename) : null)
      if (!ext) {
        await part.toBuffer().catch(() => {}) // drain so the next part can be read
        skipped.push({ name: part.filename, reason: 'not an image' })
        continue
      }
      const buf = await part.toBuffer()
      if (part.file.truncated || buf.length > MAX_UPLOAD_BYTES) {
        skipped.push({ name: part.filename, reason: 'too large' })
        continue
      }
      mkdirSync(dir, { recursive: true })
      const target = join(dir, uniqueName(dir, safeStem(part.filename), ext))
      await writeFile(target, buf)
      uploaded.push(basename(target))
    }

    // Index the new files: an incremental scan picks them up and enqueues thumbnails.
    if (uploaded.length > 0) {
      enqueueJob(app.db, 'scan', { repositoryId: repo.id }, 8)
      app.worker.kick()
    }

    return reply
      .code(uploaded.length > 0 ? 202 : 422)
      .send({ uploaded: uploaded.length, files: uploaded, skipped })
  })
}
