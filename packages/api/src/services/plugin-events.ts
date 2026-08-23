import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import type { PluginEventName, PluginManifest } from '@free-wan/shared'
import { plugins, pluginRuns } from '../db/schema'
import { enqueueJob } from './jobs'

/**
 * Fan a domain event out to every enabled plugin that subscribes to it (the "run automatically
 * when something happens" trigger). Each delivery is recorded in plugin_runs and dispatched via
 * the job worker so it is queued, audited, and isolated from the emitter. Best-effort and cheap
 * when no plugin subscribes.
 */
export function emitPluginEvent(app: FastifyInstance, event: PluginEventName, payload: unknown): void {
  if (!app.config.pluginsEnabled) return
  const rows = app.db.select().from(plugins).where(eq(plugins.enabled, 1)).all()
  let dispatched = 0
  for (const row of rows) {
    let manifest: PluginManifest
    try {
      manifest = JSON.parse(row.manifest) as PluginManifest
    } catch {
      continue
    }
    if (!manifest.events?.includes(event)) continue
    const runId = uuidv7()
    app.db
      .insert(pluginRuns)
      .values({
        id: runId,
        pluginId: row.id,
        kind: 'event',
        ref: event,
        status: 'queued',
        input: JSON.stringify({ event, payload }).slice(0, 64 * 1024),
        createdAt: Date.now(),
      })
      .run()
    enqueueJob(app.db, 'plugin_event', { runId, pluginId: row.id, event, payload }, 1)
    dispatched++
  }
  if (dispatched > 0) app.worker.kick()
}
