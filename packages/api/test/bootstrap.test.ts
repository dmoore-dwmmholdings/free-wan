import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'

/**
 * Regression tests for the bootstrap-admin credential reconcile (FR-01 / security §2).
 *
 * The footgun: first boot generates + logs a password (easy to miss on a headless
 * server); the operator then sets ADMIN_PASSWORD and restarts, but the original code
 * was a silent no-op once any admin existed — so the env password never took effect and
 * the operator could not sign in. These tests use a *file-backed* DB so admin state
 * persists across two buildApp() calls, the way a real restart does.
 */
describe('bootstrap admin reconcile across restarts', () => {
  let dir: string
  const dataDir = () => dir

  async function boot(adminPassword: string | undefined): Promise<FastifyInstance> {
    const app = await buildApp({
      env: 'test',
      dataDir: dataDir(),
      adminUsername: 'owner',
      adminPassword,
      loginRateMax: 1000,
    })
    await app.ready()
    return app
  }

  async function loginStatus(app: FastifyInstance, password: string): Promise<number> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'owner', password },
    })
    return res.statusCode
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fw-bootstrap-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('applies ADMIN_PASSWORD set after first boot generated a password', async () => {
    // First boot: no ADMIN_PASSWORD → a password is generated (and logged, not returned).
    const first = await boot(undefined)
    // The operator does not know the generated password, so any guess fails.
    expect(await loginStatus(first, 'a-guess-the-operator-makes')).toBe(401)
    await first.close()

    // Operator sets ADMIN_PASSWORD and restarts against the same data dir.
    const second = await boot('chosen-pass-1')
    expect(await loginStatus(second, 'chosen-pass-1')).toBe(200)
    await second.close()
  })

  it('does not clobber a password the admin changed through the app', async () => {
    // Admin (still must_change_password) signs in and sets its own password.
    const app = await boot('chosen-pass-1')
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'owner', password: 'chosen-pass-1' },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json().user.mustChangePassword).toBe(true)
    const cookie = login.cookies.find((c) => c.name === 'fw_session')!
    const change = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { fw_session: cookie.value },
      payload: { currentPassword: 'chosen-pass-1', newPassword: 'final-pass-9' },
    })
    expect(change.statusCode).toBe(204)
    await app.close()

    // Restart with ADMIN_PASSWORD still set: the env value must NOT be reapplied,
    // because the admin has completed first-login setup.
    const restarted = await boot('chosen-pass-1')
    expect(await loginStatus(restarted, 'final-pass-9')).toBe(200) // UI-chosen wins
    expect(await loginStatus(restarted, 'chosen-pass-1')).toBe(401) // env not reapplied
    await restarted.close()
  })
})
