import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'

const ADMIN = { username: 'admin', password: 'admin-pass-123' }

/** Log in as a native client (the mobile app) and return the bearer token. */
async function nativeLogin(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { ...ADMIN, client: 'native' },
  })
  return { res, token: res.json().token as string | undefined }
}

describe('native client auth (bearer token)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      env: 'test',
      dataDir: ':memory:',
      adminUsername: ADMIN.username,
      adminPassword: ADMIN.password,
      loginRateMax: 1000,
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns a token and sets no cookie for client:native', async () => {
    const { res, token } = await nativeLogin(app)
    expect(res.statusCode).toBe(200)
    expect(typeof token).toBe('string')
    expect(token!.length).toBeGreaterThan(20)
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined()
  })

  it('withholds the token from a browser login and still sets the cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toBeUndefined()
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeDefined()
  })

  it('authenticates a protected route with the bearer token', async () => {
    const { token } = await nativeLogin(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user).toMatchObject({ username: 'admin', role: 'admin' })
  })

  it('rejects a malformed or unknown bearer token', async () => {
    for (const header of ['Bearer', 'Bearer   ', 'Basic abc', 'Bearer not-a-real-token']) {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: header } })
      expect(res.statusCode, `header: ${header}`).toBe(401)
    }
  })

  it('stops accepting the token once the session is revoked', async () => {
    const { token } = await nativeLogin(app)
    const auth = { authorization: `Bearer ${token}` }
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth })).statusCode).toBe(200)

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth })
    expect(out.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth })).statusCode).toBe(401)
  })

  it('enforces admin-only routes through the bearer path', async () => {
    const { token } = await nativeLogin(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/plugins',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
  })
})
