import { rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq, count, desc } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { repositories, mediaItems, jobs } from '../../db/schema'
import { dirSizeBytes, ffmpegVersion } from '../../lib/system-info'

export async function adminSystemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAdmin)

  app.get('/api/admin/system', async () => {
    const dataDir = app.config.dataDir
    const repos = app.db.select().from(repositories).all()
    const repoStatus = repos.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      itemCount:
        app.db
          .select({ n: count() })
          .from(mediaItems)
          .where(and(eq(mediaItems.repositoryId, r.id), eq(mediaItems.status, 'active')))
          .get()?.n ?? 0,
    }))
    const queued = app.db.select({ n: count() }).from(jobs).where(eq(jobs.status, 'queued')).get()?.n ?? 0
    const running = app.db.select({ n: count() }).from(jobs).where(eq(jobs.status, 'running')).get()?.n ?? 0

    return {
      version: app.config.version,
      node: process.version,
      ffmpeg: await ffmpegVersion(),
      uptimeS: Math.round(process.uptime()),
      repositories: repoStatus,
      cache: {
        thumbsBytes: dirSizeBytes(join(dataDir, 'thumbs')),
        hlsBytes: dirSizeBytes(join(dataDir, 'hls')),
        exportsBytes: dirSizeBytes(join(dataDir, 'exports')),
      },
      queue: { queued, running },
    }
  })

  app.get('/api/admin/jobs', async (req) => {
    const { status } = req.query as { status?: string }
    const where = status ? eq(jobs.status, status as 'queued') : undefined
    const rows = app.db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        progress: jobs.progress,
        attempts: jobs.attempts,
        error: jobs.error,
        createdAt: jobs.createdAt,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(100)
      .all()
    return { data: rows }
  })

  // Clear the regenerable HLS transcode cache (NFR-12). Source media is untouched.
  app.post('/api/admin/cache/transcode/clear', async () => {
    const hlsDir = join(app.config.dataDir, 'hls')
    let removed = 0
    try {
      for (const entry of await readdir(hlsDir)) {
        await rm(join(hlsDir, entry), { recursive: true, force: true })
        removed++
      }
    } catch {
      /* dir may not exist yet */
    }
    return { cleared: true, removed }
  })
}
