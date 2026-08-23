import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import { mediaItems } from '../src/db/schema'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'

const fakeProber: Prober = async () => ({
  durationS: 60,
  width: 1280,
  height: 720,
  container: 'mov,mp4,m4a',
  videoCodec: 'h264',
  audioCodec: 'aac',
  audioTracks: 1,
  embeddedSubs: [],
})
const fakeThumbnailer: Thumbnailer = async ({ outDir }) => {
  await mkdir(outDir, { recursive: true })
  const p = join(outDir, 'poster.jpg')
  await writeFile(p, 'JPEG')
  return { posterPath: p }
}

describe('internal (built-in) commands', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let user: Record<string, string>
  let dataDir: string
  let root: string
  const byExecutable: Record<string, string> = {} // executable → command id

  async function runAndWait(id: string, cookies: Record<string, string>) {
    const res = await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies, payload: { args: {} } })
    if (res.statusCode !== 202) return { res, run: undefined }
    await app.worker.onIdle()
    const run = await app.inject({ method: 'GET', url: `/api/command-runs/${res.json().runId}`, cookies })
    return { res, run: run.json() }
  }

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'fw-intcmd-'))
    root = await mkdtemp(join(tmpdir(), 'fw-intcmd-media-'))
    await writeFile(join(root, 'movie.mp4'), 'x')

    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer },
    )
    await app.ready()
    const login = async (u: string, p: string) => {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })
      return { [SESSION_COOKIE]: r.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
    }
    admin = await login('admin', 'admin-pass-123')
    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: admin,
      payload: { username: 'viewer', password: 'viewer-pass-1', role: 'user', canRunCommands: true },
    })
    user = await login('viewer', 'viewer-pass-1')

    const list = await app.inject({ method: 'GET', url: '/api/admin/commands', cookies: admin })
    for (const c of list.json().data) if (c.isInternal) byExecutable[c.executable] = c.id
  })

  afterAll(async () => {
    await app.close()
    await rm(dataDir, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  })

  it('seeds the three built-ins on boot (idempotently)', async () => {
    expect(Object.keys(byExecutable).sort()).toEqual([
      'internal:clear-transcode-cache',
      'internal:rebuild-thumbnails',
      'internal:rescan',
    ])
  })

  it('rescan queues a scan per enabled library and indexes new media', async () => {
    const repo = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies: admin,
      payload: { name: 'Films', rootPath: root, type: 'video' },
    })
    expect(repo.statusCode).toBe(201)

    const { run } = await runAndWait(byExecutable['internal:rescan']!, admin)
    expect(run.status).toBe('succeeded')
    expect(run.output).toContain('1 library')
    expect(run.output).toContain('Films')
    const items = app.db.select().from(mediaItems).all()
    expect(items).toHaveLength(1) // the scan the command queued actually ran
  })

  it('rebuild-thumbnails targets only items without a poster', async () => {
    const item = app.db.select().from(mediaItems).all()[0]!
    app.db.update(mediaItems).set({ posterPath: null }).where(eq(mediaItems.id, item.id)).run()

    const { run } = await runAndWait(byExecutable['internal:rebuild-thumbnails']!, admin)
    expect(run.status).toBe('succeeded')
    expect(run.output).toContain('1 item(s)')
    expect(app.db.select().from(mediaItems).where(eq(mediaItems.id, item.id)).get()!.posterPath).not.toBeNull()

    const again = await runAndWait(byExecutable['internal:rebuild-thumbnails']!, admin)
    expect(again.run.output).toContain('0 item(s)') // nothing missing anymore
  })

  it('clear-transcode-cache empties data/hls', async () => {
    const cached = join(dataDir, 'hls', 'someitem')
    await mkdir(cached, { recursive: true })
    await writeFile(join(cached, 'index.m3u8'), '#EXTM3U')

    const { run } = await runAndWait(byExecutable['internal:clear-transcode-cache']!, admin)
    expect(run.status).toBe('succeeded')
    expect(run.output).toContain('Cleared 1')
    expect(existsSync(cached)).toBe(false)
  })

  it('cannot be deleted, and only enabled/allowNonAdmin can be patched', async () => {
    const id = byExecutable['internal:rescan']!
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/commands/${id}`, cookies: admin })).statusCode).toBe(422)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/admin/commands/${id}`,
          cookies: admin,
          payload: { executable: 'node' },
        })
      ).statusCode,
    ).toBe(422)
    const toggle = await app.inject({
      method: 'PATCH',
      url: `/api/admin/commands/${id}`,
      cookies: admin,
      payload: { enabled: false },
    })
    expect(toggle.statusCode).toBe(200)
    expect(toggle.json().enabled).toBe(false)
    // Disabled → running is forbidden, for admins too.
    expect((await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies: admin, payload: { args: {} } })).statusCode).toBe(403)
    await app.inject({ method: 'PATCH', url: `/api/admin/commands/${id}`, cookies: admin, payload: { enabled: true } })
  })

  it('is admin-only until allowNonAdmin is granted', async () => {
    const id = byExecutable['internal:clear-transcode-cache']!
    expect((await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies: user, payload: { args: {} } })).statusCode).toBe(403)
    await app.inject({ method: 'PATCH', url: `/api/admin/commands/${id}`, cookies: admin, payload: { allowNonAdmin: true } })
    const { run } = await runAndWait(id, user)
    expect(run.status).toBe('succeeded')
  })
})
