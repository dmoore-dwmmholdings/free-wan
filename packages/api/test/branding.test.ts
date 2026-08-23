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
    expect(res.json()).toMatchObject({ siteName: 'FreeWAN', mode: 'dark' })
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

  it('serves a PWA manifest reflecting the live branding (public)', async () => {
    // The earlier PUT set siteName + primary; the manifest must carry them.
    const res = await app.inject({ method: 'GET', url: '/api/manifest.webmanifest' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/manifest+json')
    const m = res.json()
    expect(m).toMatchObject({
      name: 'My Library',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0b0b10',
      theme_color: '#0b0b10',
    })
    expect(m.icons.length).toBeGreaterThanOrEqual(1)
    expect(m.icons[0]).toMatchObject({ src: '/api/branding/pwa-icon', type: 'image/svg+xml', sizes: 'any' })
  })

  it('serves a monogram pwa-icon from the brand color and site initial', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/branding/pwa-icon' })
    expect(before.statusCode).toBe(200)
    expect(before.headers['content-type']).toContain('image/svg+xml')
    expect(before.body).toContain('>M<') // monogram initial of "My Library"
    expect(before.body).toContain('#ff0000') // brand primary from the earlier PUT
  })
})

describe('pwa-icon serves an uploaded SVG logo', () => {
  it('switches from the monogram to the sanitized uploaded logo', async () => {
    // Asset uploads write real files under dataDir/branding, so use a temp dir (not :memory:).
    const dir = await mkdtemp(join(tmpdir(), 'fw-pwa-'))
    const app = await buildApp({ env: 'test', dataDir: dir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 })
    try {
      await app.ready()
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-pass-123' } })
      const admin = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }

      const boundary = 'X-TEST-BOUNDARY'
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="5"/></svg>'
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="logo.svg"',
        'Content-Type: image/svg+xml',
        '',
        svg,
        `--${boundary}--`,
        '',
      ].join('\r\n')
      const up = await app.inject({
        method: 'POST',
        url: '/api/admin/branding/asset?kind=logo',
        cookies: admin,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
      expect(up.statusCode).toBe(200)

      const icon = await app.inject({ method: 'GET', url: '/api/branding/pwa-icon' })
      expect(icon.statusCode).toBe(200)
      expect(icon.body).toContain('<circle')
    } finally {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
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
