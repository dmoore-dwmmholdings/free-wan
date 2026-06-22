import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'

describe('Phase 10 — hardening & system panel', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let viewer: Record<string, string>

  async function login(u: string, p: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  }

  beforeAll(async () => {
    app = await buildApp({ env: 'test', dataDir: ':memory:', adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 })
    await app.ready()
    admin = await login('admin', 'admin-pass-123')
    await app.inject({ method: 'POST', url: '/api/admin/users', cookies: admin, payload: { username: 'viewer', password: 'viewer-pass-1', role: 'user' } })
    viewer = await login('viewer', 'viewer-pass-1')
  })

  afterAll(async () => {
    await app.close()
  })

  it('sets security headers; no upgrade-insecure-requests; HSTS only over HTTPS', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    // Must NOT force HTTPS on subresources — that blanks the page over plain-HTTP tailnet access.
    expect(csp).not.toContain('upgrade-insecure-requests')
    // Plain HTTP request → no HSTS (so it can't pin the host to HTTPS).
    expect(res.headers['strict-transport-security']).toBeUndefined()
  })

  it('sends HSTS only when the request is HTTPS (behind a trusted proxy)', async () => {
    const tls = await buildApp({
      env: 'test',
      dataDir: ':memory:',
      adminUsername: 'admin',
      adminPassword: 'admin-pass-123',
      loginRateMax: 1000,
      trustProxy: true,
    })
    await tls.ready()
    const res = await tls.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(res.headers['strict-transport-security']).toContain('max-age=')
    await tls.close()
  })

  it('reports system info to admins', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/system', cookies: admin })
    expect(res.statusCode).toBe(200)
    const s = res.json()
    expect(s.version).toBeTruthy()
    expect(s.node).toBe(process.version)
    expect(s.ffmpeg === null || typeof s.ffmpeg === 'string').toBe(true)
    expect(s.cache).toMatchObject({ thumbsBytes: 0, hlsBytes: 0, exportsBytes: 0 })
    expect(s.queue).toMatchObject({ queued: 0, running: 0 })
    expect(Array.isArray(s.repositories)).toBe(true)
  })

  it('lists jobs and clears the transcode cache (admin)', async () => {
    expect(Array.isArray((await app.inject({ method: 'GET', url: '/api/admin/jobs', cookies: admin })).json().data)).toBe(true)
    const clear = await app.inject({ method: 'POST', url: '/api/admin/cache/transcode/clear', cookies: admin })
    expect(clear.statusCode).toBe(200)
    expect(clear.json()).toMatchObject({ cleared: true })
  })

  it('restricts the system panel to admins', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/system' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/admin/system', cookies: viewer })).statusCode).toBe(403)
  })
})
