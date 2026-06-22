import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import { sanitizeSvg } from '../src/lib/sanitize-svg'

describe('sanitizeSvg', () => {
  it('strips scripts, foreignObject, handlers, and javascript: urls', () => {
    const dirty = `<svg onload="steal()"><script>evil()</script><foreignObject><body/></foreignObject><a href="javascript:alert(1)"><rect/></a></svg>`
    const clean = sanitizeSvg(dirty)
    expect(clean).not.toMatch(/<script/i)
    expect(clean).not.toMatch(/foreignObject/i)
    expect(clean).not.toMatch(/onload/i)
    expect(clean).not.toMatch(/javascript:/i)
    expect(clean).toMatch(/<rect/)
  })
})

describe('Phase 8 — branding', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let user: Record<string, string>

  async function login(u: string, p: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  }

  beforeAll(async () => {
    app = await buildApp({ env: 'test', dataDir: ':memory:', adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 })
    await app.ready()
    admin = await login('admin', 'admin-pass-123')
    await app.inject({ method: 'POST', url: '/api/admin/users', cookies: admin, payload: { username: 'viewer', password: 'viewer-pass-1', role: 'user' } })
    user = await login('viewer', 'viewer-pass-1')
  })
  afterAll(async () => {
    await app.close()
  })

  it('serves default branding publicly (no auth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/branding' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ siteName: 'Free-WAN', mode: 'dark' })
  })

  it('admin updates branding (deep-merged) and it is reflected', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/branding',
      cookies: admin,
      payload: { siteName: 'My Library', colors: { primary: '#ff0000' } },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toMatchObject({ siteName: 'My Library' })
    expect(put.json().colors.primary).toBe('#ff0000')
    // other colors preserved by the merge
    expect(put.json().colors.background).toBe('#0b0b10')

    const get = await app.inject({ method: 'GET', url: '/api/branding' })
    expect(get.json().siteName).toBe('My Library')
  })

  it('rejects an invalid color', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/admin/branding', cookies: admin, payload: { colors: { primary: 'red' } } })
    expect(res.statusCode).toBe(422)
  })

  it('enforces admin-only editing', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/admin/branding', payload: { siteName: 'x' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'PUT', url: '/api/admin/branding', cookies: user, payload: { siteName: 'x' } })).statusCode).toBe(403)
  })
})

describe('branding persists across restart', () => {
  it('keeps a saved site name after reopening the same data dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fw-brand-'))
    const a = await buildApp({ env: 'test', dataDir: dir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 })
    await a.ready()
    const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-pass-123' } })
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
    await a.inject({ method: 'PUT', url: '/api/admin/branding', cookies, payload: { siteName: 'Persisted' } })
    await a.close()

    const b = await buildApp({ env: 'test', dataDir: dir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 })
    await b.ready()
    expect((await b.inject({ method: 'GET', url: '/api/branding' })).json().siteName).toBe('Persisted')
    await b.close()
    await rm(dir, { recursive: true, force: true })
  })
})
