import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'
import type { ClipExporter } from '../src/services/clip-export'

const fakeProber: Prober = async () => ({
  durationS: 100,
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
const fakeClipExporter: ClipExporter = async ({ outPath }) => {
  await writeFile(outPath, 'EXPORTDATA')
}

describe('Phase 7 — clips & loops', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let bob: Record<string, string>
  let root: string
  let dataDir: string
  let repoId: string
  let videoId: string
  let clipId: string

  async function login(u: string, p: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-clip-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-clipd-'))
    await mkdir(join(root, 'V'), { recursive: true })
    await writeFile(join(root, 'V', 'movie.mp4'), 'x')

    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer, clipExporter: fakeClipExporter },
    )
    await app.ready()
    admin = await login('admin', 'admin-pass-123')
    await app.inject({ method: 'POST', url: '/api/admin/users', cookies: admin, payload: { username: 'bob', password: 'bob-pass-123', role: 'user' } })
    bob = await login('bob', 'bob-pass-123')

    const create = await app.inject({ method: 'POST', url: '/api/admin/repositories', cookies: admin, payload: { name: 'V', rootPath: root, type: 'video' } })
    repoId = create.json().id
    await app.inject({ method: 'POST', url: `/api/admin/repositories/${repoId}/scan`, cookies: admin, payload: {} })
    await app.worker.onIdle()
    videoId = (await app.inject({ method: 'GET', url: '/api/media', cookies: admin })).json().data[0].id
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('creates a clip with a valid range', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/clips', cookies: admin, payload: { sourceItemId: videoId, name: 'Best bit', startS: 5, endS: 15 } })
    expect(res.statusCode).toBe(201)
    const c = res.json()
    expect(c).toMatchObject({ name: 'Best bit', startS: 5, endS: 15, durationS: 10, loop: true, orphaned: false, exportStatus: 'none' })
    clipId = c.id
  })

  it('validates the range (end>start, max length)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/clips', cookies: admin, payload: { sourceItemId: videoId, name: 'bad', startS: 10, endS: 5 } })).statusCode).toBe(422)
    expect((await app.inject({ method: 'POST', url: '/api/clips', cookies: admin, payload: { sourceItemId: videoId, name: 'long', startS: 0, endS: 9999 } })).statusCode).toBe(422)
  })

  it('lists, reads, and patches a clip', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/clips', cookies: admin })).json().data).toHaveLength(1)
    const patch = await app.inject({ method: 'PATCH', url: `/api/clips/${clipId}`, cookies: admin, payload: { startS: 2, endS: 8, loop: false } })
    expect(patch.json()).toMatchObject({ startS: 2, endS: 8, loop: false })
    expect((await app.inject({ method: 'PATCH', url: `/api/clips/${clipId}`, cookies: admin, payload: { endS: 1 } })).statusCode).toBe(422)
  })

  it('returns a virtual-loop preview descriptor', async () => {
    const p = (await app.inject({ method: 'GET', url: `/api/clips/${clipId}/preview`, cookies: admin })).json()
    expect(p).toMatchObject({ sourceUrl: `/api/media/${videoId}/stream`, startS: 2, endS: 8, loop: false, orphaned: false })
  })

  it('exports a clip via the job and serves the download', async () => {
    const ex = await app.inject({ method: 'POST', url: `/api/clips/${clipId}/export`, cookies: admin, payload: { format: 'mp4' } })
    expect(ex.statusCode).toBe(202)
    await app.worker.onIdle()
    const status = await app.inject({ method: 'GET', url: `/api/clips/${clipId}/export`, cookies: admin })
    expect(status.json()).toMatchObject({ status: 'ready', downloadUrl: `/api/clips/${clipId}/download` })
    const dl = await app.inject({ method: 'GET', url: `/api/clips/${clipId}/download`, cookies: admin })
    expect(dl.statusCode).toBe(200)
    expect(dl.headers['content-type']).toBe('video/mp4')
    expect(dl.body).toBe('EXPORTDATA')
  })

  it('isolates clips per-user (FR-61)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/clips', cookies: bob })).json().data).toHaveLength(0)
    expect((await app.inject({ method: 'GET', url: `/api/clips/${clipId}`, cookies: bob })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/clips/${clipId}`, cookies: bob })).statusCode).toBe(404)
  })

  it('flags the clip orphaned when its source is removed, but keeps the export', async () => {
    // Deleting the repo cascades the media item; the clip's source_item_id is SET NULL.
    await app.inject({ method: 'DELETE', url: `/api/admin/repositories/${repoId}`, cookies: admin })
    const c = (await app.inject({ method: 'GET', url: `/api/clips/${clipId}`, cookies: admin })).json()
    expect(c.orphaned).toBe(true)
    expect(c.sourceItemId).toBeNull()
    expect(c.posterUrl).toBeNull()
    // re-exporting an orphan is rejected…
    expect((await app.inject({ method: 'POST', url: `/api/clips/${clipId}/export`, cookies: admin, payload: { format: 'mp4' } })).statusCode).toBe(409)
    // …but the already-exported file still downloads (FR-44).
    expect((await app.inject({ method: 'GET', url: `/api/clips/${clipId}/download`, cookies: admin })).statusCode).toBe(200)
  })

  it('requires auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/clips' })).statusCode).toBe(401)
  })
})
