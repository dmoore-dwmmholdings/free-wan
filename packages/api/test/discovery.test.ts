import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'

const fakeProber: Prober = async (abs) =>
  abs.endsWith('.mp4')
    ? {
        durationS: 100,
        width: 1920,
        height: 1080,
        container: 'mov,mp4,m4a',
        videoCodec: 'h264',
        audioCodec: 'aac',
        audioTracks: 1,
        embeddedSubs: [],
      }
    : { width: 800, height: 600, audioTracks: 0, embeddedSubs: [] }

const fakeThumbnailer: Thumbnailer = async ({ outDir }) => {
  await mkdir(outDir, { recursive: true })
  const poster = join(outDir, 'poster.jpg')
  await writeFile(poster, 'JPEGDATA')
  return { posterPath: poster }
}

describe('Phase 3 — discovery', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let root: string
  let dataDir: string
  type Card = { id: string; title: string; type: string; categoryPath: string | null; posterUrl: string }
  let cards: Card[]

  async function list(qs: string) {
    const res = await app.inject({ method: 'GET', url: `/api/media${qs}`, cookies })
    return res.json() as { data: Card[]; nextCursor: string | null; total: number }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-disc-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-data-'))
    await mkdir(join(root, 'Movies', 'Action'), { recursive: true })
    await mkdir(join(root, 'Movies', 'Comedy'), { recursive: true })
    await mkdir(join(root, 'Photos'), { recursive: true })
    await writeFile(join(root, 'Movies', 'Action', 'alpha.mp4'), 'x')
    await writeFile(join(root, 'Movies', 'Comedy', 'bravo.mp4'), 'x')
    await writeFile(join(root, 'Photos', 'charlie.jpg'), 'x')
    await writeFile(join(root, 'Photos', 'delta.jpg'), 'x')
    await writeFile(join(root, 'echo.mp4'), 'x')

    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer },
    )
    await app.ready()
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin-pass-123' },
    })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies,
      payload: { name: 'Lib', rootPath: root, type: 'mixed' },
    })
    await app.inject({
      method: 'POST',
      url: `/api/admin/repositories/${create.json().id}/scan`,
      cookies,
      payload: {},
    })
    await app.worker.onIdle() // scan + thumbnail jobs
    cards = (await list('')).data
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('lists all active items with poster URLs and leaf category paths', async () => {
    const all = await list('')
    expect(all.total).toBe(5)
    const alpha = all.data.find((c) => c.title === 'alpha')!
    expect(alpha.categoryPath).toBe('Movies/Action')
    expect(alpha.posterUrl).toBe(`/api/media/${alpha.id}/poster`)
  })

  it('full-text searches title and folder-derived category names', async () => {
    expect((await list('?q=alpha')).data.map((c) => c.title)).toEqual(['alpha'])
    // "Action" is a folder name, not in any title — FTS still matches via categories column
    expect((await list('?q=Action')).data.map((c) => c.title)).toEqual(['alpha'])
    expect((await list('?q=zzzznope')).total).toBe(0)
  })

  it('filters by type and by (nested) category', async () => {
    expect((await list('?type=image')).total).toBe(2)
    expect((await list('?type=video')).total).toBe(3)

    const roots = await app.inject({ method: 'GET', url: '/api/categories', cookies })
    const movies = (roots.json().data as Array<{ id: string; name: string }>).find((c) => c.name === 'Movies')!
    const nested = await list(`?category=${movies.id}`)
    expect(nested.data.map((c) => c.title).sort()).toEqual(['alpha', 'bravo'])
  })

  it('sorts by title and paginates with a cursor', async () => {
    const asc = await list('?sort=title&order=asc')
    expect(asc.data.map((c) => c.title)).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo'])

    const page1 = await list('?sort=title&order=asc&limit=2')
    expect(page1.data.map((c) => c.title)).toEqual(['alpha', 'bravo'])
    expect(page1.nextCursor).toBeTruthy()
    const page2 = await list(`?sort=title&order=asc&limit=2&cursor=${page1.nextCursor}`)
    expect(page2.data.map((c) => c.title)).toEqual(['charlie', 'delta'])
  })

  it('returns detail with the full category chain', async () => {
    const alpha = cards.find((c) => c.title === 'alpha')!
    const res = await app.inject({ method: 'GET', url: `/api/media/${alpha.id}`, cookies })
    expect(res.statusCode).toBe(200)
    const d = res.json()
    expect(d.categories.map((c: { path: string }) => c.path)).toEqual(['Movies', 'Movies/Action'])
    expect(d.playbackMode).toBe('direct')
    expect(d.videoCodec).toBe('h264')
  })

  it('serves a generated poster', async () => {
    const alpha = cards.find((c) => c.title === 'alpha')!
    const res = await app.inject({ method: 'GET', url: `/api/media/${alpha.id}/poster`, cookies })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/jpeg')
    expect(res.body).toBe('JPEGDATA')
  })

  it('navigates the category tree with item counts and hasChildren', async () => {
    const roots = await app.inject({ method: 'GET', url: '/api/categories', cookies })
    const data = roots.json().data as Array<{ id: string; name: string; itemCount: number; hasChildren: boolean }>
    const movies = data.find((c) => c.name === 'Movies')!
    expect(movies.itemCount).toBe(2)
    expect(movies.hasChildren).toBe(true)
    expect(data.find((c) => c.name === 'Photos')!.hasChildren).toBe(false)

    const children = await app.inject({ method: 'GET', url: `/api/categories?parent=${movies.id}`, cookies })
    expect((children.json().data as Array<{ name: string }>).map((c) => c.name).sort()).toEqual(['Action', 'Comedy'])

    const action = (children.json().data as Array<{ id: string; name: string }>).find((c) => c.name === 'Action')!
    const node = await app.inject({ method: 'GET', url: `/api/categories/${action.id}`, cookies })
    expect((node.json().ancestors as Array<{ name: string }>).map((a) => a.name)).toEqual(['Movies'])
  })

  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/media' })).statusCode).toBe(401)
  })
})
