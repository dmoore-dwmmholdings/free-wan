import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import { resolveWithinRoot } from '../src/lib/path-safety'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'

const fakeProber: Prober = async () => ({
  durationS: 100,
  width: 1920,
  height: 1080,
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

describe('path-safety resolver', () => {
  it('accepts an in-root file and rejects traversal / missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fw-ps-'))
    await writeFile(join(root, 'ok.txt'), 'x')
    expect(resolveWithinRoot(root, 'ok.txt')).toContain('ok.txt')
    expect(() => resolveWithinRoot(root, '../escape.txt')).toThrow()
    expect(() => resolveWithinRoot(root, 'nope.txt')).toThrow()
    await rm(root, { recursive: true, force: true })
  })
})

describe('Phase 4 — playback', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let root: string
  let dataDir: string
  let videoId: string
  let captionId: string

  async function login(username: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } })
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-pb-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-pbdata-'))
    await mkdir(join(root, 'Movies'), { recursive: true })
    await writeFile(join(root, 'Movies', 'clip.mp4'), 'ABCDEFGHIJ') // 10 known bytes
    await writeFile(join(root, 'Movies', 'clip.en.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n')

    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer },
    )
    await app.ready()
    cookies = await login('admin', 'admin-pass-123')

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies,
      payload: { name: 'V', rootPath: root, type: 'video' },
    })
    await app.inject({ method: 'POST', url: `/api/admin/repositories/${create.json().id}/scan`, cookies, payload: {} })
    await app.worker.onIdle()
    const list = await app.inject({ method: 'GET', url: '/api/media', cookies })
    videoId = list.json().data[0].id
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('returns a direct-play descriptor with caption tracks', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/media/${videoId}/playback`, cookies })
    expect(res.statusCode).toBe(200)
    const d = res.json()
    expect(d.mode).toBe('direct')
    expect(d.url).toBe(`/api/media/${videoId}/stream`)
    expect(d.duration).toBe(100)
    expect(d.captions).toHaveLength(1)
    expect(d.captions[0].language).toBe('en')
    captionId = d.captions[0].id
    expect(d.resumeAt).toBeNull()
  })

  it('streams full content with the right type and Accept-Ranges', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/media/${videoId}/stream`, cookies })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('video/mp4')
    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(res.headers['content-length']).toBe('10')
    expect(res.body).toBe('ABCDEFGHIJ')
  })

  it('honors a byte Range with 206 partial content', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/media/${videoId}/stream`,
      cookies,
      headers: { range: 'bytes=2-5' },
    })
    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe('bytes 2-5/10')
    expect(res.headers['content-length']).toBe('4')
    expect(res.body).toBe('CDEF')
  })

  it('serves a sidecar .vtt caption directly', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/media/${videoId}/captions/${captionId}.vtt`,
      cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/vtt')
    expect(res.body).toContain('WEBVTT')
  })

  it('saves resume position and marks watched at ≥92%', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/media/${videoId}/progress`,
          cookies,
          payload: { positionS: 30, durationS: 100 },
        })
      ).statusCode,
    ).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/api/media/${videoId}/playback`, cookies })).json().resumeAt).toBe(30)

    // crossing the watched threshold clears the resume prompt and stays watched
    await app.inject({
      method: 'POST',
      url: `/api/media/${videoId}/progress`,
      cookies,
      payload: { positionS: 95, durationS: 100 },
    })
    expect((await app.inject({ method: 'GET', url: `/api/media/${videoId}/playback`, cookies })).json().resumeAt).toBeNull()
  })

  it('keeps progress per-user', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies,
      payload: { username: 'viewer', password: 'viewer-pass-1', role: 'user' },
    })
    const viewer = await login('viewer', 'viewer-pass-1')
    const res = await app.inject({ method: 'GET', url: `/api/media/${videoId}/playback`, cookies: viewer })
    expect(res.json().resumeAt).toBeNull() // independent of admin's watched state
  })

  it('requires authentication for streaming', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/media/${videoId}/stream` })).statusCode).toBe(401)
  })
})
