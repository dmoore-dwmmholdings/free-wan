import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { UiBlock } from '@free-wan/shared'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import { emitPluginEvent } from '../src/services/plugin-events'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(here, '..', 'examples', 'plugins')
const STATS = 'com.freewan.library-stats'
const LOGGER = 'com.freewan.new-media-logger'
const PROBE = 'com.freewan.permission-probe'

/** Flatten a UI view into a list of blocks for assertions. */
function flatten(view: unknown): UiBlock[] {
  const out: UiBlock[] = []
  const walk = (b: unknown) => {
    if (Array.isArray(b)) return b.forEach(walk)
    if (!b || typeof b !== 'object') return
    out.push(b as UiBlock)
    const children = (b as { children?: unknown[] }).children
    if (Array.isArray(children)) children.forEach(walk)
  }
  walk(view)
  return out
}

describe('Phase 10 — plugins', () => {
  let app: FastifyInstance
  let dataDir: string
  let admin: Record<string, string>
  let viewer: Record<string, string>

  async function login(u: string, p: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  }
  const install = (path: string, cookies = admin) =>
    app.inject({ method: 'POST', url: '/api/admin/plugins/install', cookies, payload: { source: 'path', path } })
  const enable = (id: string) =>
    app.inject({ method: 'PATCH', url: `/api/admin/plugins/${id}`, cookies: admin, payload: { enabled: true } })

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'fw-plugtest-'))
    app = await buildApp({ env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 }, {})
    await app.ready()
    admin = await login('admin', 'admin-pass-123')
    await app.inject({ method: 'POST', url: '/api/admin/users', cookies: admin, payload: { username: 'viewer', password: 'viewer-pass-1', role: 'user' } })
    viewer = await login('viewer', 'viewer-pass-1')
  }, 30_000)

  afterAll(async () => {
    await app.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('installs a plugin from a directory (disabled until enabled)', async () => {
    const res = await install(join(examples, 'library-stats'))
    expect(res.statusCode).toBe(201)
    const dto = res.json()
    expect(dto.id).toBe(STATS)
    expect(dto.enabled).toBe(false)
    expect(dto.permissions).toContain('media:read')
  })

  it('rejects a non-existent install path', async () => {
    const res = await install(join(examples, 'does-not-exist'))
    expect(res.statusCode).toBe(422)
  })

  it('admin listing includes the manifest and declared permissions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/plugins', cookies: admin })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: Array<{ id: string; manifest: unknown }>; enabled: boolean }
    expect(body.enabled).toBe(true)
    expect(body.data.find((p) => p.id === STATS)?.manifest).toBeTruthy()
  })

  it('does not list a disabled plugin to users', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins', cookies: viewer })
    expect((res.json().data as unknown[]).length).toBe(0)
  })

  it('enables a plugin and renders its panel through a forked process', async () => {
    expect((await enable(STATS)).statusCode).toBe(200)
    const res = await app.inject({ method: 'GET', url: `/api/plugins/${STATS}/panels/main`, cookies: admin })
    expect(res.statusCode).toBe(200)
    const blocks = flatten(res.json().view)
    expect(blocks.some((b) => b.type === 'text' && b.variant === 'heading')).toBe(true)
    expect(blocks.some((b) => b.type === 'stat' && b.label === 'Items')).toBe(true)
  }, 20_000)

  it('handles a panel action that writes to plugin storage and re-renders', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/plugins/${STATS}/panels/main/action`,
      cookies: admin,
      payload: { action: 'save', fields: { note: 'hello world' } },
    })
    expect(res.statusCode).toBe(200)
    const blocks = flatten(res.json().view)
    expect(blocks.some((b) => b.type === 'notice' && b.text.includes('hello world'))).toBe(true)
  }, 20_000)

  it('runs a plugin command via the worker and records the run', async () => {
    const start = await app.inject({ method: 'POST', url: `/api/plugins/${STATS}/commands/count/run`, cookies: admin, payload: { args: { type: 'all' } } })
    expect(start.statusCode).toBe(202)
    const runId = start.json().runId
    await app.worker.onIdle()
    const run = await app.inject({ method: 'GET', url: `/api/plugins/${STATS}/runs/${runId}`, cookies: admin })
    const body = run.json() as { status: string; output: string | null }
    expect(body.status).toBe('succeeded')
    expect(body.output ?? '').toContain('Library has 0')
  }, 20_000)

  it('reinstalls an enabled plugin in place (stops it, replaces files, restarts)', async () => {
    // STATS is enabled from an earlier test; reinstalling must not require a manual disable and
    // must leave it working (regression: a running daemon used to lock its own install dir).
    const res = await install(join(examples, 'library-stats'))
    expect(res.statusCode).toBe(201)
    const panel = await app.inject({ method: 'GET', url: `/api/plugins/${STATS}/panels/main`, cookies: admin })
    expect(panel.statusCode).toBe(200)
  }, 20_000)

  it('enforces Host API permissions (clips.create without clips:write)', async () => {
    expect((await install(join(examples, 'permission-probe'))).statusCode).toBe(201)
    await enable(PROBE)
    const start = await app.inject({ method: 'POST', url: `/api/plugins/${PROBE}/commands/badclip/run`, cookies: admin, payload: { args: {} } })
    const runId = start.json().runId
    await app.worker.onIdle()
    const run = await app.inject({ method: 'GET', url: `/api/plugins/${PROBE}/runs/${runId}`, cookies: admin })
    const body = run.json() as { status: string; error: string | null }
    expect(body.status).toBe('failed')
    expect(body.error ?? '').toMatch(/permission/i)
  }, 20_000)

  it('delivers domain events to a subscribed plugin', async () => {
    expect((await install(join(examples, 'new-media-logger'))).statusCode).toBe(201)
    await enable(LOGGER)
    emitPluginEvent(app, 'scan.completed', { repositoryId: 'r1', indexed: 3 })
    emitPluginEvent(app, 'scan.completed', { repositoryId: 'r1', indexed: 1 })
    await app.worker.onIdle()
    const start = await app.inject({ method: 'POST', url: `/api/plugins/${LOGGER}/commands/report/run`, cookies: admin, payload: { args: {} } })
    await app.worker.onIdle()
    const run = await app.inject({ method: 'GET', url: `/api/plugins/${LOGGER}/runs/${start.json().runId}`, cookies: admin })
    expect((run.json().output ?? '') as string).toContain('count:scan.completed')
  }, 20_000)

  it('applies user permissions (allowNonAdmin) and protects admin routes', async () => {
    // viewer sees the plugin (it has allowNonAdmin panels/commands) and may run the command…
    const list = await app.inject({ method: 'GET', url: '/api/plugins', cookies: viewer })
    expect((list.json().data as Array<{ id: string }>).some((p) => p.id === STATS)).toBe(true)
    const run = await app.inject({ method: 'POST', url: `/api/plugins/${STATS}/commands/count/run`, cookies: viewer, payload: { args: { type: 'all' } } })
    expect(run.statusCode).toBe(202)
    // …but cannot reach admin endpoints.
    expect((await app.inject({ method: 'GET', url: '/api/admin/plugins', cookies: viewer })).statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/plugins/${STATS}`, cookies: viewer })).statusCode).toBe(403)
  }, 20_000)

  it('uninstalls a plugin (stops process, removes files and row)', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/plugins/${PROBE}`, cookies: admin })
    expect(res.statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: '/api/admin/plugins', cookies: admin })
    expect((list.json().data as Array<{ id: string }>).some((p) => p.id === PROBE)).toBe(false)
  })
})
