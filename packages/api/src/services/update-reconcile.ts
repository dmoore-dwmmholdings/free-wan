import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { appUpdates } from '../db/schema'
import { resolvePaths, readPending, clearPending } from './updater'

/**
 * On boot, finalize a just-applied update: if the newest history row is `pending_restart` and the
 * running version matches it, mark it `success` and clear the supervisor's pending marker. This is
 * what lets the changelog confirm the update actually took.
 *
 * If instead we came up on a DIFFERENT version and the supervisor's pending marker is gone, the
 * new code crash-looped and the supervisor rolled it back — record that, otherwise the Updates
 * panel shows "Restarting" forever. (Marker still present = still awaiting a manual restart on an
 * unsupervised install; leave the row alone.) Any older rows still stuck in `pending_restart` are
 * swept the same way.
 */
export function reconcilePendingUpdate(app: FastifyInstance): void {
  const pendingRows = app.db
    .select()
    .from(appUpdates)
    .where(eq(appUpdates.status, 'pending_restart'))
    .orderBy(desc(appUpdates.appliedAt))
    .all()
  if (pendingRows.length === 0) return
  const paths = resolvePaths()
  const [latest, ...stale] = pendingRows

  if (latest!.version === app.config.version) {
    app.db.update(appUpdates).set({ status: 'success' }).where(eq(appUpdates.id, latest!.id)).run()
    if (readPending(paths)) {
      try {
        clearPending(paths)
      } catch {
        /* best-effort */
      }
    }
    app.log.info(`Update to ${latest!.version} is live`)
  } else if (!readPending(paths)) {
    app.db
      .update(appUpdates)
      .set({
        status: 'rolled_back',
        note: 'The new version failed to start and the previous version was restored automatically. Check the server logs (the first crash after the update) for the reason.',
      })
      .where(eq(appUpdates.id, latest!.id))
      .run()
    app.log.warn(`Update to ${latest!.version} was rolled back (running ${app.config.version})`)
  }

  for (const row of stale) {
    app.db
      .update(appUpdates)
      .set({ status: 'rolled_back', note: 'This update never came up; a later update superseded it.' })
      .where(eq(appUpdates.id, row.id))
      .run()
  }
}
