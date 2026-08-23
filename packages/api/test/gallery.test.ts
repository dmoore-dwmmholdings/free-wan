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
import type { FrameGrabber } from '../src/services/frame-grabber'

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
// Instrumented fakes: count invocations per output path and track peak concurrency,
// so the tests can assert single-flight dedupe and the global ffmpeg cap.
const makerCalls = new Map<string, number>()
let activeMakers = 0
let peakMakers = 0
async function trackMaker(outPath: string): Promise<void> {
  makerCalls.set(outPath, (makerCalls.get(outPath) ?? 0) + 1)
  activeMakers++
  peakMakers = Math.max(peakMakers, activeMakers)
  await new Promise((r) => setTimeout(r, 25))
  activeMakers--
}
const fakeImageVariant: ImageVariantMaker = async ({ outPath }) => {
  await trackMaker(outPath)
  await writeFile(outPath, 'VARIANTBYTES')
}
const grabbedTimes: number[] = []
const fakeFrameGrabber: FrameGrabber = async ({ timeS, outPath }) => {
  grabbedTimes.push(timeS)
  await trackMaker(outPath)
  await writeFile(outPath, 'FRAMEBYTES')
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
      { prober: fakeProber, thumbnailer: fakeThumbnailer, imageVariant: fakeImageVariant, frameGrabber: fakeFrameGrabber },
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

  it('serves a scrub-preview frame and caches it immutably', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/media/${videoId}/frame?t=2`, cookies })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers['cache-control']).toContain('immutable')
    expect(res.body).toBe('FRAMEBYTES')
  })

  it('rejects a frame request with a missing/invalid time', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/media/${videoId}/frame`, cookies })).statusCode).toBe(422)
    expect((await app.inject({ method: 'GET', url: `/api/media/${videoId}/frame?t=-1`, cookies })).statusCode).toBe(422)
  })

  it('rejects /frame for an image', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/media/${imageId}/frame?t=0`, cookies })).statusCode).toBe(404)
  })

  it('requires authentication for /frame', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/media/${videoId}/frame?t=2` })).statusCode).toBe(401)
  })

  it('clamps a frame request at the exact end of the video to a grabbable time', async () => {
    // durationS is 5 (fakeProber); extracting at exactly t=5 finds no frame, so the route
    // must ask the grabber for a slightly earlier time instead of 404ing.
    const res = await app.inject({ method: 'GET', url: `/api/media/${videoId}/frame?t=5`, cookies })
    expect(res.statusCode).toBe(200)
    const last = grabbedTimes[grabbedTimes.length - 1]!
    expect(last).toBeLessThan(5)
  })

  it('deduplicates concurrent requests for the same uncached variant (single ffmpeg spawn)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        app.inject({ method: 'GET', url: `/api/media/${imageId}/raw?w=999`, cookies }),
      ),
    )
    for (const res of results) {
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('VARIANTBYTES')
    }
    const calls = [...makerCalls.entries()].filter(([p]) => p.includes('w999.jpg'))
    expect(calls).toHaveLength(1)
    expect(calls[0]![1]).toBe(1)
  })

  it('caps concurrent variant generation across distinct files', async () => {
    peakMakers = 0
    const widths = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008]
    const results = await Promise.all(
      widths.map((w) => app.inject({ method: 'GET', url: `/api/media/${imageId}/raw?w=${w}`, cookies })),
    )
    for (const res of results) expect(res.statusCode).toBe(200)
    expect(peakMakers).toBeGreaterThan(0)
    expect(peakMakers).toBeLessThanOrEqual(4)
  })
})
