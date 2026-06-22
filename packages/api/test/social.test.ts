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
    ? { durationS: 10, container: 'mov,mp4,m4a', videoCodec: 'h264', audioCodec: 'aac', audioTracks: 1, embeddedSubs: [] }
    : { width: 100, height: 100, audioTracks: 0, embeddedSubs: [] }
const fakeThumbnailer: Thumbnailer = async ({ outDir }) => {
  await mkdir(outDir, { recursive: true })
  const p = join(outDir, 'poster.jpg')
  await writeFile(p, 'JPEG')
  return { posterPath: p }
}

describe('Phase 5 — likes & collections', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let bob: Record<string, string>
  let root: string
  let dataDir: string
  let A: string
  let B: string

  async function login(username: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } })
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  }
  const list = async (qs: string, cookies: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: `/api/media${qs}`, cookies })).json() as {
      data: Array<{ id: string; title: string; liked: boolean; likeCount: number }>
      total: number
    }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-soc-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-socd-'))
    await mkdir(join(root, 'M'), { recursive: true })
    await writeFile(join(root, 'M', 'alpha.mp4'), 'x')
    await writeFile(join(root, 'M', 'bravo.mp4'), 'x')

    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer },
    )
    await app.ready()
    admin = await login('admin', 'admin-pass-123')
    await app.inject({ method: 'POST', url: '/api/admin/users', cookies: admin, payload: { username: 'bob', password: 'bob-pass-123', role: 'user' } })
    bob = await login('bob', 'bob-pass-123')

    const create = await app.inject({ method: 'POST', url: '/api/admin/repositories', cookies: admin, payload: { name: 'M', rootPath: root, type: 'video' } })
    await app.inject({ method: 'POST', url: `/api/admin/repositories/${create.json().id}/scan`, cookies: admin, payload: {} })
    await app.worker.onIdle()
    const items = (await list('?sort=title&order=asc', admin)).data
    A = items.find((i) => i.title === 'alpha')!.id
    B = items.find((i) => i.title === 'bravo')!.id
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('toggles a like idempotently and returns the count', async () => {
    const r1 = await app.inject({ method: 'PUT', url: `/api/media/${A}/like`, cookies: admin })
    expect(r1.json()).toEqual({ liked: true, likeCount: 1 })
    const r2 = await app.inject({ method: 'PUT', url: `/api/media/${A}/like`, cookies: admin })
    expect(r2.json()).toEqual({ liked: true, likeCount: 1 }) // idempotent
    const card = (await list('', admin)).data.find((i) => i.id === A)!
    expect(card.liked).toBe(true)
    expect(card.likeCount).toBe(1)
  })

  it('keeps liked state per-user but counts in aggregate', async () => {
    const bobCard = (await list('', bob)).data.find((i) => i.id === A)!
    expect(bobCard.liked).toBe(false) // bob hasn't liked it
    expect(bobCard.likeCount).toBe(1) // but sees the aggregate count
    const r = await app.inject({ method: 'PUT', url: `/api/media/${A}/like`, cookies: bob })
    expect(r.json()).toEqual({ liked: true, likeCount: 2 })
  })

  it('filters to liked-by-me and sorts by popularity', async () => {
    // counts now: A = 2 (admin+bob), B = 0. Like B once so popularity has a clear order.
    await app.inject({ method: 'PUT', url: `/api/media/${B}/like`, cookies: admin })
    const liked = await list('?liked=true', admin)
    expect(liked.data.map((i) => i.id).sort()).toEqual([A, B].sort())

    const pop = await list('?sort=popularity&order=desc', admin)
    expect(pop.data[0]!.id).toBe(A) // A (2 likes) ahead of B (1)
  })

  it('unlikes back to a lower count', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/api/media/${B}/like`, cookies: admin })
    expect(r.json()).toEqual({ liked: false, likeCount: 0 })
  })

  it('creates a collection, adds/reorders/removes items, and views it', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/collections', cookies: admin, payload: { name: 'Faves' } })
    expect(create.statusCode).toBe(201)
    const cid = create.json().id

    expect((await app.inject({ method: 'GET', url: '/api/collections', cookies: admin })).json().data).toHaveLength(1)

    await app.inject({ method: 'POST', url: `/api/collections/${cid}/items`, cookies: admin, payload: { mediaItemId: A } })
    await app.inject({ method: 'POST', url: `/api/collections/${cid}/items`, cookies: admin, payload: { mediaItemId: B } })
    expect((await list(`?collection=${cid}`, admin)).data.map((i) => i.id)).toEqual([A, B])

    await app.inject({ method: 'PATCH', url: `/api/collections/${cid}/items`, cookies: admin, payload: { order: [B, A] } })
    expect((await list(`?collection=${cid}`, admin)).data.map((i) => i.id)).toEqual([B, A])

    await app.inject({ method: 'DELETE', url: `/api/collections/${cid}/items/${A}`, cookies: admin })
    expect((await list(`?collection=${cid}`, admin)).data.map((i) => i.id)).toEqual([B])

    const patch = await app.inject({ method: 'PATCH', url: `/api/collections/${cid}`, cookies: admin, payload: { name: 'Renamed', coverItemId: B } })
    expect(patch.json()).toMatchObject({ name: 'Renamed', coverItemId: B, itemCount: 1 })

    expect((await app.inject({ method: 'DELETE', url: `/api/collections/${cid}`, cookies: admin })).statusCode).toBe(204)
  })

  it('isolates collections per-user (FR-61)', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/collections', cookies: admin, payload: { name: 'Private' } })
    const cid = create.json().id
    // bob does not see it and cannot mutate it
    expect((await app.inject({ method: 'GET', url: '/api/collections', cookies: bob })).json().data).toHaveLength(0)
    expect((await app.inject({ method: 'POST', url: `/api/collections/${cid}/items`, cookies: bob, payload: { mediaItemId: A } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/collections/${cid}`, cookies: bob })).statusCode).toBe(404)
  })

  it('requires auth for likes', async () => {
    expect((await app.inject({ method: 'PUT', url: `/api/media/${A}/like` })).statusCode).toBe(401)
  })
})
