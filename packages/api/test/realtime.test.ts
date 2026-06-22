import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import { createLogger } from '../src/lib/logger'
import { openDatabase } from '../src/db/client'
import { EventHub } from '../src/services/events'
import { WatcherManager } from '../src/services/watcher'
import type { Prober } from '../src/services/ffprobe'

const fakeProber: Prober = async () => ({
  durationS: 10,
  container: 'mov,mp4,m4a',
  videoCodec: 'h264',
  audioCodec: 'aac',
  audioTracks: 1,
  embeddedSubs: [],
})

describe('EventHub', () => {
  it('delivers to subscribers and stops after unsubscribe', () => {
    const hub = new EventHub()
    const got: unknown[] = []
    const off = hub.subscribe('scan:r1', (d) => got.push(d))
    hub.publish('scan:r1', { a: 1 })
    hub.publish('other:r1', { a: 2 }) // different topic, ignored
    off()
    hub.publish('scan:r1', { a: 3 }) // after unsubscribe, ignored
    expect(got).toEqual([{ a: 1 }])
    expect(hub.subscriberCount('scan:r1')).toBe(0)
  })
})

describe('WatcherManager debounce', () => {
  it('coalesces rapid events into one onChange after the window', () => {
    vi.useFakeTimers()
    const { db, sqlite } = openDatabase(':memory:')
    const calls: string[] = []
    const wm = new WatcherManager(db, createLogger('test'), (id) => calls.push(id), {
      enabled: true,
      debounceMs: 1000,
    })
    wm.schedule('r1')
    wm.schedule('r1')
    wm.schedule('r1')
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual(['r1'])
    sqlite.close()
    vi.useRealTimers()
  })
})

describe('realtime scan progress + WebSocket', () => {
  let app: FastifyInstance
  let adminCookies: Record<string, string>
  let cookieHeader: string
  let root: string
  let repoId: string

  beforeAll(async () => {
    app = await buildApp(
      { env: 'test', dataDir: ':memory:', adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber },
    )
    await app.ready()
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin-pass-123' },
    })
    const c = login.cookies.find((x) => x.name === SESSION_COOKIE)!
    adminCookies = { [SESSION_COOKIE]: c.value }
    cookieHeader = `${SESSION_COOKIE}=${c.value}`

    root = await mkdtemp(join(tmpdir(), 'fw-rt-'))
    await mkdir(join(root, 'A'), { recursive: true })
    await writeFile(join(root, 'A', 'v.mp4'), 'x')
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies: adminCookies,
      payload: { name: 'RT', rootPath: root, type: 'video' },
    })
    repoId = create.json().id
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
  })

  it('publishes scan progress events to the hub during a scan', async () => {
    const events: Array<{ status: string; found: number; indexed: number }> = []
    const off = app.events.subscribe(`scan:${repoId}`, (d) => events.push(d as never))

    const scan = await app.inject({
      method: 'POST',
      url: `/api/admin/repositories/${repoId}/scan`,
      cookies: adminCookies,
      payload: {},
    })
    expect(scan.statusCode).toBe(202)
    await app.worker.onIdle()
    off()

    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0]?.status).toBe('scanning')
    const final = events[events.length - 1]!
    expect(final.status).toBe('online')
    expect(final.indexed).toBe(1)
  })

  it('rejects an unauthenticated WebSocket upgrade', async () => {
    const ws = await app.injectWS('/api/ws')
    const code = await new Promise<number>((resolve) => ws.on('close', (c: number) => resolve(c)))
    expect(code).toBe(1008)
  })

  it('forwards subscribed hub events to an authenticated WebSocket client', async () => {
    const ws = await app.injectWS('/api/ws', { headers: { cookie: cookieHeader } })
    const received = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data: Buffer) => resolve(JSON.parse(data.toString())))
    })
    ws.send(JSON.stringify({ type: 'subscribe', topic: `scan:${repoId}` }))
    // let the server register the subscription, then publish
    await new Promise((r) => setTimeout(r, 50))
    app.events.publish(`scan:${repoId}`, { type: 'scan', repositoryId: repoId, status: 'online', progress: 1 })

    const msg = await received
    expect(msg).toMatchObject({ type: 'scan', status: 'online' })
    ws.terminate()
  })
})
