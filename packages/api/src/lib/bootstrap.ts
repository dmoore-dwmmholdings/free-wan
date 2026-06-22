import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import { users } from '../db/schema'
import { hashPassword, verifyPassword } from './auth'

/**
 * First-run admin bootstrap (security §2). Two responsibilities, both idempotent:
 *
 *  1. **Create** the admin if none exists. The password comes from ADMIN_PASSWORD,
 *     or is generated and logged. The admin is flagged `must_change_password` so it
 *     is forced to set a new one on first login.
 *
 *  2. **Reconcile** an already-created admin that has *not yet completed first-login
 *     setup* (`must_change_password` still set) with the credentials supplied via the
 *     environment. This fixes a real footgun: on the first boot a password was
 *     generated and logged (easy to miss on a headless server); the operator then set
 *     ADMIN_PASSWORD and restarted, but bootstrap was a silent no-op, so the env
 *     password never took effect and they could not sign in.
 *
 * The environment-configured credentials are therefore authoritative *until the admin
 * changes its password through the app* (which clears `must_change_password`). After
 * that, ADMIN_PASSWORD is never applied again, so a password the operator deliberately
 * set via the UI is never clobbered on the next restart.
 */
export async function bootstrapAdmin(app: FastifyInstance): Promise<void> {
  const username = app.config.adminUsername
  const configuredPassword = app.config.adminPassword

  const existing = app.db.select().from(users).where(eq(users.role, 'admin')).get()
  if (existing) {
    await reconcileBootstrapAdmin(app, existing, configuredPassword)
    return
  }

  let password = configuredPassword
  let generated = false
  if (!password) {
    password = randomBytes(12).toString('base64url')
    generated = true
  }

  const now = Date.now()
  app.db
    .insert(users)
    .values({
      id: uuidv7(),
      username,
      passwordHash: await hashPassword(password),
      role: 'admin',
      canRunCommands: 1,
      disabled: 0,
      mustChangePassword: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  if (generated) {
    app.log.warn(
      `Bootstrap admin created — username="${username}" password="${password}" — ` +
        `set ADMIN_PASSWORD and restart to choose your own, or sign in and change it on first login`,
    )
  } else {
    app.log.info(`Bootstrap admin "${username}" created; change the password on first login`)
  }
}

/**
 * Apply env-configured credentials to an admin that hasn't finished first-login setup.
 * No-op when: no password is configured, the admin has already completed setup, or the
 * stored password already matches (so we don't re-hash on every boot).
 */
async function reconcileBootstrapAdmin(
  app: FastifyInstance,
  existing: typeof users.$inferSelect,
  configuredPassword: string | undefined,
): Promise<void> {
  // Empty string (the docker-compose default when ADMIN_PASSWORD is unset) counts as
  // "not configured" — never reset the admin to a blank password.
  if (!configuredPassword) return
  if (!existing.mustChangePassword) return
  if (await verifyPassword(configuredPassword, existing.passwordHash)) return

  app.db
    .update(users)
    .set({ passwordHash: await hashPassword(configuredPassword), updatedAt: Date.now() })
    .where(eq(users.id, existing.id))
    .run()

  app.log.info(
    `Bootstrap admin "${existing.username}" password updated from ADMIN_PASSWORD; ` +
      `change it on first login`,
  )
}
