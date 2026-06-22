import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { desc, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import { appUpdates } from '../../db/schema'
import {
  resolvePaths,
  validatePackage,
  applyPackage,
  rollbackLatest,
  UpdateError,
  UPDATE_RESTART_CODE,
} from '../../services/updater'

const MAX_PACKAGE_BYTES = 200 * 1024 * 1024

// Single-flight guard: only one update may be applying at a time.
let inProgress = false

function scheduleRestart(app: FastifyInstance): void {
  if (app.config.env === 'test') return
  app.log.info('Update applied — restarting to load the new version')
  setTimeout(() => process.exit(UPDATE_RESTART_CODE), 500)
}

export async function adminUpdateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAdmin)

  app.get('/api/admin/updates', async () => {
    const history = app.db.select().from(appUpdates).orderBy(desc(appUpdates.appliedAt)).limit(50).all()
    return {
      current: app.config.version,
      supervised: process.env.FW_SUPERVISED === '1',
      inProgress,
      history: history.map((h) => ({
        version: h.version,
        changelog: h.changelog,
        status: h.status,
        appliedAt: h.appliedAt,
        note: h.note,
      })),
    }
  })

  app.post('/api/admin/updates', async (req, reply) => {
    if (inProgress) {
      return reply.code(409).send({ error: { code: 'conflict', message: 'An update is already in progress' } })
    }
    const part = await req.file({ limits: { fileSize: MAX_PACKAGE_BYTES } })
    if (!part) return reply.code(422).send({ error: { code: 'validation_error', message: 'No package file' } })

    const paths = resolvePaths()
    mkdirSync(paths.work, { recursive: true })
    const incoming = join(paths.work, 'incoming.zip')
    await pipeline(part.file, createWriteStream(incoming))
    if (part.file.truncated) {
      rmSync(incoming, { force: true })
      return reply.code(413).send({ error: { code: 'too_large', message: 'Package exceeds the size limit' } })
    }

    // Validate before changing anything on disk.
    let version: string
    let changelog: string | null
    try {
      const { manifest } = await validatePackage(incoming)
      version = manifest.version
      changelog = manifest.changelog ?? null
    } catch (e) {
      rmSync(incoming, { force: true })
      const message = e instanceof UpdateError ? e.message : 'Invalid package'
      return reply.code(422).send({ error: { code: 'validation_error', message } })
    }

    inProgress = true
    const id = uuidv7()
    app.db
      .insert(appUpdates)
      .values({ id, version, changelog, status: 'applying', appliedAt: Date.now(), note: null })
      .run()

    try {
      const result = await applyPackage(incoming, paths)
      app.db.update(appUpdates).set({ status: 'pending_restart' }).where(eq(appUpdates.id, id)).run()
      const supervised = process.env.FW_SUPERVISED === '1'
      void reply.code(202).send({ version: result.version, restarting: supervised })
      if (supervised) scheduleRestart(app)
      return reply
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Update failed'
      app.db.update(appUpdates).set({ status: 'failed', note: message }).where(eq(appUpdates.id, id)).run()
      return reply.code(500).send({ error: { code: 'update_failed', message } })
    } finally {
      inProgress = false
      rmSync(incoming, { force: true })
    }
  })

  app.post('/api/admin/updates/rollback', async (req, reply) => {
    if (inProgress) {
      return reply.code(409).send({ error: { code: 'conflict', message: 'An update is in progress' } })
    }
    const paths = resolvePaths()
    try {
      const { restoredFrom } = await rollbackLatest(paths)
      app.db
        .insert(appUpdates)
        .values({
          id: uuidv7(),
          version: app.config.version,
          changelog: null,
          status: 'rolled_back',
          appliedAt: Date.now(),
          note: `restored ${restoredFrom}`,
        })
        .run()
      const supervised = process.env.FW_SUPERVISED === '1'
      void reply.code(202).send({ restarting: supervised })
      if (supervised) scheduleRestart(app)
      return reply
    } catch (e) {
      const message = e instanceof UpdateError ? e.message : 'Rollback failed'
      return reply.code(400).send({ error: { code: 'rollback_failed', message } })
    }
  })
}
