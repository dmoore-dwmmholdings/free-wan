import { createReadStream, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { progressRequestSchema, type PlaybackDescriptor } from '@free-wan/shared'
import { mediaItems, repositories, subtitleTracks, playbackProgress } from '../db/schema'
import { resolveWithinRoot } from '../lib/path-safety'
import { contentTypeForExt } from '../lib/content-types'
import { extOf } from '../lib/media-types'

const notFound = { error: { code: 'not_found', message: 'Media not found' } }

export async function playbackRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  app.get('/api/media/:id/playback', async (req, reply) => {
    const { id } = req.params as { id: string }
    const item = app.db
      .select()
      .from(mediaItems)
      .where(and(eq(mediaItems.id, id), eq(mediaItems.status, 'active')))
      .get()
    if (!item) return reply.code(404).send(notFound)
    if (item.type !== 'video') {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'Not a playable video' } })
    }

    const mode = item.playbackMode ?? 'hls'
    const url = mode === 'direct' ? `/api/media/${id}/stream` : `/api/media/${id}/hls/master.m3u8`
    const subs = app.db.select().from(subtitleTracks).where(eq(subtitleTracks.mediaItemId, id)).all()
    const captions = subs.map((s) => ({
      id: s.id,
      label: s.label ?? s.language ?? (s.kind === 'sidecar' ? 'Subtitle' : 'Embedded'),
      language: s.language,
      url: `/api/media/${id}/captions/${s.id}.vtt`,
      default: false,
    }))
    const prog = app.db
      .select()
      .from(playbackProgress)
      .where(and(eq(playbackProgress.userId, req.user!.id), eq(playbackProgress.mediaItemId, id)))
      .get()
    const resumeAt = prog && !prog.watched && prog.positionS > 5 ? prog.positionS : null

    const descriptor: PlaybackDescriptor = { mode, url, captions, resumeAt, duration: item.durationS }
    return descriptor
  })

  app.get('/api/media/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string }
    const item = app.db
      .select()
      .from(mediaItems)
      .where(and(eq(mediaItems.id, id), eq(mediaItems.status, 'active')))
      .get()
    if (!item) return reply.code(404).send(notFound)
    const repo = app.db.select().from(repositories).where(eq(repositories.id, item.repositoryId)).get()
    if (!repo) return reply.code(404).send(notFound)

    let abs: string
    try {
      abs = resolveWithinRoot(repo.rootPath, item.relPath)
    } catch {
      return reply.code(404).send(notFound) // missing file or path escape → 404
    }
    const size = statSync(abs).size
    reply.header('Accept-Ranges', 'bytes').type(contentTypeForExt(item.ext))

    const range = req.headers.range
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!m || (!m[1] && !m[2])) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send()
      }
      let start = m[1] ? Number(m[1]) : 0
      let end = m[2] ? Number(m[2]) : size - 1
      if (Number.isNaN(start)) start = 0
      if (Number.isNaN(end) || end >= size) end = size - 1
      if (start > end || start >= size) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send()
      }
      reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1)
      return reply.send(createReadStream(abs, { start, end }))
    }

    reply.code(200).header('Content-Length', size)
    return reply.send(createReadStream(abs))
  })

  app.get('/api/media/:id/captions/:trackId.vtt', async (req, reply) => {
    const { id, trackId } = req.params as { id: string; trackId: string }
    const track = app.db
      .select()
      .from(subtitleTracks)
      .where(and(eq(subtitleTracks.id, trackId), eq(subtitleTracks.mediaItemId, id)))
      .get()
    if (!track) return reply.code(404).send({ error: { code: 'not_found', message: 'Caption track not found' } })
    const item = app.db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()
    if (!item) return reply.code(404).send(notFound)
    const repo = app.db.select().from(repositories).where(eq(repositories.id, item.repositoryId)).get()
    if (!repo) return reply.code(404).send(notFound)

    reply.type('text/vtt').header('Cache-Control', 'public, max-age=3600')
    try {
      if (track.kind === 'sidecar' && track.relPath) {
        const abs = resolveWithinRoot(repo.rootPath, track.relPath)
        if (extOf(track.relPath) === 'vtt') return reply.send(readFileSync(abs, 'utf8'))
        return reply.send(await app.captionConverter({ absPath: abs }))
      }
      const abs = resolveWithinRoot(repo.rootPath, item.relPath)
      return reply.send(await app.captionConverter({ absPath: abs, streamIndex: track.streamIndex ?? 0 }))
    } catch {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Caption source unavailable' } })
    }
  })

  // ---- On-the-fly HLS (media pipeline §8) ----
  app.get('/api/media/:id/hls/master.m3u8', async (req, reply) => {
    const { id } = req.params as { id: string }
    const item = app.db
      .select()
      .from(mediaItems)
      .where(and(eq(mediaItems.id, id), eq(mediaItems.status, 'active')))
      .get()
    if (!item || item.type !== 'video') return reply.code(404).send(notFound)
    const repo = app.db.select().from(repositories).where(eq(repositories.id, item.repositoryId)).get()
    if (!repo) return reply.code(404).send(notFound)
    try {
      const abs = resolveWithinRoot(repo.rootPath, item.relPath)
      app.transcoder.ensure(id, abs)
    } catch {
      return reply.code(404).send(notFound)
    }
    reply.type('application/vnd.apple.mpegurl').header('Cache-Control', 'no-store')
    // Single growing rendition for v1; the media playlist is index.m3u8 (relative).
    return '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000\nindex.m3u8\n'
  })

  app.get('/api/media/:id/hls/:file', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string }
    // Only our own playlist/segment names — no path traversal.
    if (!/^(index\.m3u8|seg_\d+\.ts)$/.test(file)) {
      return reply.code(400).send({ error: { code: 'validation_error', message: 'Bad segment name' } })
    }
    app.transcoder.touch(id)
    const abs = join(app.transcoder.outDirFor(id), file)
    // On a fresh transcode the playlist may not be written yet; wait briefly.
    if (!existsSync(abs) && file === 'index.m3u8') {
      for (let i = 0; i < 50 && !existsSync(abs); i++) await delay(100)
    }
    if (!existsSync(abs)) return reply.code(404).send(notFound)

    const isPlaylist = file.endsWith('.m3u8')
    reply
      .type(isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
      .header('Cache-Control', isPlaylist ? 'no-store' : 'public, max-age=31536000, immutable')
    return reply.send(createReadStream(abs))
  })

  app.post('/api/media/:id/progress', async (req, reply) => {
    const parsed = progressRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'Invalid input' } })
    }
    const { id } = req.params as { id: string }
    const item = app.db
      .select({ id: mediaItems.id, durationS: mediaItems.durationS })
      .from(mediaItems)
      .where(eq(mediaItems.id, id))
      .get()
    if (!item) return reply.code(404).send(notFound)

    const dur = parsed.data.durationS ?? item.durationS ?? null
    const existing = app.db
      .select({ watched: playbackProgress.watched })
      .from(playbackProgress)
      .where(and(eq(playbackProgress.userId, req.user!.id), eq(playbackProgress.mediaItemId, id)))
      .get()
    // Watched is sticky once reached (≥92% of duration).
    const watched =
      (dur && parsed.data.positionS >= 0.92 * dur) || existing?.watched === 1 ? 1 : 0
    const now = Date.now()
    app.db
      .insert(playbackProgress)
      .values({
        userId: req.user!.id,
        mediaItemId: id,
        positionS: parsed.data.positionS,
        durationS: dur,
        watched,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [playbackProgress.userId, playbackProgress.mediaItemId],
        set: { positionS: parsed.data.positionS, durationS: dur, watched, updatedAt: now },
      })
      .run()
    return reply.code(204).send()
  })
}
