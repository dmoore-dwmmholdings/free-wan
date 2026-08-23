import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { basename, join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { repositories } from '../db/schema'
import { enqueueJob } from '../services/jobs'
import { IMAGE_EXTS, VIDEO_EXTS, extOf } from '../lib/media-types'

/** Where uploads land inside the target repo (also becomes their category). */
const UPLOAD_SUBDIR = 'Uploads'
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB — videos are large; we stream to disk.
const MAX_FILES = 50

// mimetype → canonical extension (images + videos). Mobile browsers often send a generic or empty
// mimetype for videos, so we also fall back to the file's own extension below.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'video/x-ms-wmv': 'wmv',
  'video/mpeg': 'mpg',
  'video/mp2t': 'ts',
  'video/x-flv': 'flv',
  'video/ogg': 'ogv',
  'video/3gpp': 'mp4',
}

type Kind = 'image' | 'video'

/** Resolve a usable extension + media kind from a part's mimetype, falling back to its filename. */
function resolveFile(mimetype: string, filename: string): { ext: string; kind: Kind } | null {
  const mimeExt = MIME_EXT[mimetype]
  if (mimeExt) return { ext: mimeExt, kind: VIDEO_EXTS.has(mimeExt) ? 'video' : 'image' }
  const e = extOf(filename)
  if (IMAGE_EXTS.has(e)) return { ext: e, kind: 'image' }
  if (VIDEO_EXTS.has(e)) return { ext: e, kind: 'video' }
  return null
}

const repoAccepts = (repoType: string, kind: Kind): boolean => repoType === 'mixed' || repoType === kind

function safeStem(filename: string): string {
  const stem = filename
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w .-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return stem || 'upload'
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

  // Repositories a user may upload into: writable and media-capable (any of image/video/mixed).
  app.get('/api/upload/targets', async () => {
    const rows = app.db
      .select()
      .from(repositories)
      .where(and(eq(repositories.readOnly, 0), inArray(repositories.type, ['image', 'video', 'mixed'])))
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
    if (repo.type !== 'image' && repo.type !== 'video' && repo.type !== 'mixed') {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'Repository does not accept uploads' } })
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
      const resolved = resolveFile(part.mimetype, part.filename)
      if (!resolved || !repoAccepts(repo.type, resolved.kind)) {
        part.file.resume() // drain to nowhere so the next part can be read — toBuffer() would hold a whole (up to 2 GB) rejected file in memory
        const reason = !resolved
          ? 'unsupported file type'
          : `this library only accepts ${repo.type === 'video' ? 'videos' : 'images'}`
        skipped.push({ name: part.filename, reason })
        continue
      }
      mkdirSync(dir, { recursive: true })
      const name = uniqueName(dir, safeStem(part.filename), resolved.ext)
      const target = join(dir, name)
      // Stream straight to disk so a large video never has to fit in memory.
      try {
        await pipeline(part.file, createWriteStream(target))
      } catch {
        await rm(target, { force: true }).catch(() => {})
        skipped.push({ name: part.filename, reason: 'write failed' })
        continue
      }
      if (part.file.truncated) {
        await rm(target, { force: true }).catch(() => {})
        skipped.push({ name: part.filename, reason: 'too large' })
        continue
      }
      uploaded.push(basename(target))
    }

    // Index the new files: an incremental scan picks them up and enqueues thumbnails/probes.
    if (uploaded.length > 0) {
      enqueueJob(app.db, 'scan', { repositoryId: repo.id }, 8)
      app.worker.kick()
    }

    return reply
      .code(uploaded.length > 0 ? 202 : 422)
      .send({ uploaded: uploaded.length, files: uploaded, skipped })
  })
}
