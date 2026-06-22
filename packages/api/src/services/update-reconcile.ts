import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { appUpdates } from '../db/schema'
import { resolvePaths, readPending, clearPending } from './updater'

/**
 * On boot, finalize a just-applied update: if the newest history row is `pending_restart` and the
 * running version matches it, mark it `success` and clear the supervisor's pending marker. This is
 * what lets the changelog confirm the update actually took. A version mismatch (the new code did
 * not come up as expected) is left in place for the supervisor's crash-loop rollback to handle.
 */
export function reconcilePendingUpdate(app: FastifyInstance): void {
  const latest = app.db.select().from(appUpdates).orderBy(desc(appUpdates.appliedAt)).limit(1).get()
  if (!latest || latest.status !== 'pending_restart') return
  if (latest.version === app.config.version) {
    app.db.update(appUpdates).set({ status: 'success' }).where(eq(appUpdates.id, latest.id)).run()
    const paths = resolvePaths()
    if (readPending(paths)) {
      try {
        clearPending(paths)
      } catch {
        /* best-effort */
      }
    }
    app.log.info(`Update to ${latest.version} is live`)
  }
}
