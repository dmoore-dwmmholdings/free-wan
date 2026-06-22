import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'
import type { ImageVariantMaker } from '../src/services/images'

const fakeProber: Prober = async (abs) =>
  abs.endsWith('.mp4')
    ? { durationS: 5, container: 'mov,mp4,m4a', videoCodec: 'h264', audioCodec: 'aac', audioTracks: 1, embeddedSubs: [] }
    : { width: 4000, height: 3000, audioTracks: 0, embeddedSubs: [] }
const fakeThumbnailer: Thumbnailer = async ({ outDir }) => {
  await mkdir(outDir, { recursive: true })
  const p = join(outDir, 'poster.jpg')
  await writeFile(p, 'JPEG')
  return { posterPath: p }
}
const fakeImageVariant: ImageVariantMaker = async ({ outPath }) => {
  await writeFile(outPath, 'VARIANTBYTES')
}

describe('Phase 6 — image gallery /raw', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let root: string
  let dataDir: string
  let imageId: string
  let videoId: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-gal-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-gald-'))
    await mkdir(join(root, 'Photos'), { recursive: true })
    await writeFile(join(root, 'Photos', 'pic.jpg'), 'ORIGINALJPEGBYTES')
    await writeFile(join(root, 'clip.mp4'), 'x')

    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer, imageVariant: fakeImageVariant },
    )
    await app.ready()
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-pass-123' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
    const create = await app.inject({ method: 'POST', url: '/api/admin/repositories', cookies, payload: { name: 'P', rootPath: root, type: 'mixed' } })
    await app.inject({ method: 'POST', url: `/api/admin/repositories/${create.json().id}/scan`, cookies, payload: {} })
    await app.worker.onIdle()
    const items = (await app.inject({ method: 'GET', url: '/api/media', cookies })).json().data as Array<{ id: string; type: string }>
    imageId = items.find((i) => i.type === 'image')!.id
    videoId = items.find((i) => i.type === 'video')!.id
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('serves the original image bytes', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/media/${imageId}/raw`, cookies })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.body).toBe('ORIGINALJPEGBYTES')
  })

  it('serves a width-resized variant and caches it immutably', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/media/${imageId}/raw?w=640`, cookies })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers['cache-control']).toContain('immutable')
    expect(res.body).toBe('VARIANTBYTES')
  })

  it('rejects /raw for a video', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/media/${videoId}/raw`, cookies })).statusCode).toBe(404)
  })

  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/media/${imageId}/raw` })).statusCode).toBe(401)
  })
})
