import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'

const fakeProber: Prober = async () => ({ width: 800, height: 600, audioTracks: 0, embeddedSubs: [] })
const fakeThumbnailer: Thumbnailer = async ({ outDir }) => {
  await mkdir(outDir, { recursive: true })
  const p = join(outDir, 'poster.jpg')
  await writeFile(p, 'JPEG')
  return { posterPath: p }
}

describe('tags', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let root: string
  let dataDir: string
  let idA: string
  let idB: string

  const post = (url: string, body?: unknown) => app.inject({ method: 'POST', url, cookies, payload: body ?? {} })
  const get = (url: string) => app.inject({ method: 'GET', url, cookies })

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-tag-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-tagd-'))
    await writeFile(join(root, 'alpha.jpg'), 'a')
    await writeFile(join(root, 'bravo.jpg'), 'b')

    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer },
    )
    await app.ready()
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-pass-123' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
    const repo = await app.inject({ method: 'POST', url: '/api/admin/repositories', cookies, payload: { name: 'R', rootPath: root, type: 'mixed' } })
    await post(`/api/admin/repositories/${repo.json().id}/scan`)
    await app.worker.onIdle()
    const items = (await get('/api/media')).json().data as Array<{ id: string; title: string }>
    idA = items.find((i) => i.title === 'alpha')!.id
    idB = items.find((i) => i.title === 'bravo')!.id
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('creates a tag and is idempotent by name (case-insensitive)', async () => {
    const a = await post('/api/tags', { name: 'Beach' })
    expect(a.statusCode).toBe(201)
    const id = a.json().id as string
    const b = await post('/api/tags', { name: 'beach' }) // same tag, different case
    expect(b.statusCode).toBe(200)
    expect(b.json().id).toBe(id)
  })

  it('assigns tags to items (creating by name) and AND-filters the library', async () => {
    // A gets beach + 2024; B gets beach only.
    await post(`/api/media/${idA}/tags`, { name: 'beach' })
    await post(`/api/media/${idA}/tags`, { name: '2024' })
    await post(`/api/media/${idB}/tags`, { name: 'beach' })

    const tags = (await get('/api/tags')).json().data as Array<{ id: string; name: string; itemCount: number }>
    const beach = tags.find((t) => t.name === 'Beach')!
    const y2024 = tags.find((t) => t.name === '2024')!
    expect(beach.itemCount).toBe(2)
    expect(y2024.itemCount).toBe(1)

    const both = (await get(`/api/media?tag=${beach.id}`)).json().data as Array<{ id: string }>
    expect(both.map((x) => x.id).sort()).toEqual([idA, idB].sort())

    // AND: only A carries BOTH beach and 2024.
    const and = (await get(`/api/media?tag=${beach.id}&tag=${y2024.id}`)).json().data as Array<{ id: string }>
    expect(and.map((x) => x.id)).toEqual([idA])
  })

  it('exposes an item’s tags on its detail and removes them', async () => {
    const detail = (await get(`/api/media/${idA}`)).json() as { tags: Array<{ id: string; name: string }> }
    expect(detail.tags.map((t) => t.name).sort()).toEqual(['2024', 'Beach'])

    const beachId = detail.tags.find((t) => t.name === 'Beach')!.id
    const del = await app.inject({ method: 'DELETE', url: `/api/media/${idA}/tags/${beachId}`, cookies })
    expect(del.statusCode).toBe(204)
    const after = (await get(`/api/media/${idA}`)).json() as { tags: Array<{ name: string }> }
    expect(after.tags.map((t) => t.name)).toEqual(['2024'])
  })

  it('deleting a tag cascades its assignments', async () => {
    const tags = (await get('/api/tags')).json().data as Array<{ id: string; name: string }>
    const y2024 = tags.find((t) => t.name === '2024')!
    const del = await app.inject({ method: 'DELETE', url: `/api/tags/${y2024.id}`, cookies })
    expect(del.statusCode).toBe(204)
    const after = (await get(`/api/media/${idA}`)).json() as { tags: Array<{ name: string }> }
    expect(after.tags).toEqual([])
  })

  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/tags' })).statusCode).toBe(401)
  })
})
