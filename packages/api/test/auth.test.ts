import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { LightMyRequestResponse } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'

const ADMIN = { username: 'admin', password: 'admin-pass-123' }

function cookieFrom(res: LightMyRequestResponse): Record<string, string> {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE)
  if (!c) return {}
  return { [SESSION_COOKIE]: c.value }
}

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  })
  return { res, cookies: cookieFrom(res) }
}

describe('Phase 1 — auth & users', () => {
  let app: FastifyInstance
  let adminCookies: Record<string, string>
  let userCookies: Record<string, string>
  let createdUserId: string

  beforeAll(async () => {
    app = await buildApp({
      env: 'test',
      dataDir: ':memory:',
      adminUsername: ADMIN.username,
      adminPassword: ADMIN.password,
      loginRateMax: 1000, // don't let rate-limiting interfere with the flow tests
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('bootstrap admin can log in and is flagged mustChangePassword', async () => {
    const { res, cookies } = await login(app, ADMIN.username, ADMIN.password)
    expect(res.statusCode).toBe(200)
    expect(res.json().user).toMatchObject({
      username: 'admin',
      role: 'admin',
      mustChangePassword: true,
    })
    expect(cookies[SESSION_COOKIE]).toBeTruthy()
    adminCookies = cookies
  })

  it('rejects a bad password with a generic 401', async () => {
    const { res } = await login(app, ADMIN.username, 'wrong-password')
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
  })

  it('GET /api/auth/me requires a session', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(anon.statusCode).toBe(401)
    const authed = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: adminCookies })
    expect(authed.statusCode).toBe(200)
    expect(authed.json().user.username).toBe('admin')
  })

  it('admin can create a user who can then log in', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: adminCookies,
      payload: { username: 'alice', password: 'alice-pass-1', role: 'user' },
    })
    expect(create.statusCode).toBe(201)
    createdUserId = create.json().id
    expect(create.json()).toMatchObject({ username: 'alice', role: 'user', disabled: false })

    const { res, cookies } = await login(app, 'alice', 'alice-pass-1')
    expect(res.statusCode).toBe(200)
    userCookies = cookies
  })

  it('rejects a duplicate username with 409', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: adminCookies,
      payload: { username: 'alice', password: 'another-pass-1', role: 'user' },
    })
    expect(dup.statusCode).toBe(409)
  })

  describe('authorization matrix', () => {
    const adminRoute = { method: 'GET' as const, url: '/api/admin/users' }
    const userRoute = { method: 'GET' as const, url: '/api/auth/me' }
    const publicRoute = { method: 'GET' as const, url: '/api/health' }

    it('anon: public ok, user/admin routes 401', async () => {
      expect((await app.inject(publicRoute)).statusCode).toBe(200)
      expect((await app.inject(userRoute)).statusCode).toBe(401)
      expect((await app.inject(adminRoute)).statusCode).toBe(401)
    })

    it('user: public+user ok, admin route 403', async () => {
      expect((await app.inject({ ...publicRoute, cookies: userCookies })).statusCode).toBe(200)
      expect((await app.inject({ ...userRoute, cookies: userCookies })).statusCode).toBe(200)
      expect((await app.inject({ ...adminRoute, cookies: userCookies })).statusCode).toBe(403)
    })

    it('admin: all three ok', async () => {
      expect((await app.inject({ ...publicRoute, cookies: adminCookies })).statusCode).toBe(200)
      expect((await app.inject({ ...userRoute, cookies: adminCookies })).statusCode).toBe(200)
      expect((await app.inject({ ...adminRoute, cookies: adminCookies })).statusCode).toBe(200)
    })
  })

  it('change-password clears mustChangePassword and rejects a wrong current password', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: userCookies,
      payload: { currentPassword: 'nope', newPassword: 'alice-pass-2' },
    })
    expect(wrong.statusCode).toBe(401)

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: userCookies,
      payload: { currentPassword: 'alice-pass-1', newPassword: 'alice-pass-2' },
    })
    expect(ok.statusCode).toBe(204)

    // old password no longer works; new one does
    expect((await login(app, 'alice', 'alice-pass-1')).res.statusCode).toBe(401)
    expect((await login(app, 'alice', 'alice-pass-2')).res.statusCode).toBe(200)
  })

  it('disabled user cannot log in', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${createdUserId}`,
      cookies: adminCookies,
      payload: { disabled: true },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().disabled).toBe(true)
    expect((await login(app, 'alice', 'alice-pass-2')).res.statusCode).toBe(401)
  })

  it('logout revokes the session', async () => {
    const { cookies } = await login(app, ADMIN.username, ADMIN.password)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies })).statusCode).toBe(200)
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies })
    expect(out.statusCode).toBe(204)
    // the revoked session no longer authenticates
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies })).statusCode).toBe(401)
  })

  it('cannot delete or demote the last admin', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: adminCookies })
    const adminId = me.json().user.id
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${adminId}`,
      cookies: adminCookies,
    })
    expect(del.statusCode).toBe(409)
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${adminId}`,
      cookies: adminCookies,
      payload: { role: 'user' },
    })
    expect(demote.statusCode).toBe(409)
  })
})

describe('login rate limiting', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      env: 'test',
      dataDir: ':memory:',
      adminUsername: 'admin',
      adminPassword: 'admin-pass-123',
      loginRateMax: 5,
    })
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('returns 429 after exceeding the cap', async () => {
    let saw429 = false
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'wrong' },
      })
      if (res.statusCode === 429) saw429 = true
    }
    expect(saw429).toBe(true)
  })
})
