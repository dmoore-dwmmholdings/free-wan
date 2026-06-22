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
    ? { durationS: 10, width: 1920, height: 1080, videoCodec: 'h264', audioCodec: 'aac', audioTracks: 1, embeddedSubs: [] }
    : { width: 800, height: 600, audioTracks: 0, embeddedSubs: [] }

const fakeThumbnailer: Thumbnailer = async ({ outDir }) => {
  await mkdir(outDir, { recursive: true })
  const poster = join(outDir, 'poster.jpg')
  await writeFile(poster, 'JPEGDATA')
  return { posterPath: poster }
}

/**
 * The Photos/Video tabs filter by *repository* type, so /api/media and /api/categories
 * must support `repositoryType`. Set up one video-only repo and one image-only repo.
 */
describe('repositoryType filter (Photos/Video tabs)', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let vidRoot: string
  let picRoot: string
  let dataDir: string

  async function add(name: string, rootPath: string, type: string): Promise<void> {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies,
      payload: { name, rootPath, type },
    })
    expect(create.statusCode).toBe(201)
    await app.inject({
      method: 'POST',
      url: `/api/admin/repositories/${create.json().id}/scan`,
      cookies,
      payload: {},
    })
  }

  async function titles(qs: string): Promise<string[]> {
    const res = await app.inject({ method: 'GET', url: `/api/media${qs}`, cookies })
    return (res.json().data as Array<{ title: string }>).map((c) => c.title).sort()
  }

  beforeAll(async () => {
    vidRoot = await mkdtemp(join(tmpdir(), 'fw-vid-'))
    picRoot = await mkdtemp(join(tmpdir(), 'fw-pic-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-rtf-'))
    await mkdir(join(vidRoot, 'Action'), { recursive: true })
    await writeFile(join(vidRoot, 'Action', 'movie1.mp4'), 'x')
    await writeFile(join(vidRoot, 'Action', 'movie2.mp4'), 'x')
    await mkdir(join(picRoot, 'Trip'), { recursive: true })
    await writeFile(join(picRoot, 'Trip', 'photo1.jpg'), 'x')
    await writeFile(join(picRoot, 'photo2.jpg'), 'x')

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

    await add('Videos', vidRoot, 'video')
    await add('Pics', picRoot, 'image')
    await app.worker.onIdle()
  })

  afterAll(async () => {
    await app.close()
    await rm(vidRoot, { recursive: true, force: true })
    await rm(picRoot, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('media filters by a single repository type', async () => {
    expect(await titles('?repositoryType=video')).toEqual(['movie1', 'movie2'])
    expect(await titles('?repositoryType=image')).toEqual(['photo1', 'photo2'])
  })

  it('media filters by multiple repository types (the Photos tab)', async () => {
    expect(await titles('?repositoryType=image&repositoryType=mixed')).toEqual(['photo1', 'photo2'])
    // No filter → everything.
    expect(await titles('')).toEqual(['movie1', 'movie2', 'photo1', 'photo2'])
  })

  it('category tree is scoped to repository type', async () => {
    const vid = await app.inject({ method: 'GET', url: '/api/categories?repositoryType=video', cookies })
    expect((vid.json().data as Array<{ name: string }>).map((c) => c.name)).toEqual(['Action'])
    const pics = await app.inject({ method: 'GET', url: '/api/categories?repositoryType=image', cookies })
    expect((pics.json().data as Array<{ name: string }>).map((c) => c.name)).toEqual(['Trip'])
  })
})
