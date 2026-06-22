import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'
import type { TranscodeStarter } from '../src/services/transcode'

// A non-browser-friendly file → playbackMode 'hls'.
const fakeProber: Prober = async () => ({
  durationS: 60,
  width: 3840,
  height: 2160,
  container: 'matroska,webm',
  videoCodec: 'hevc',
  audioCodec: 'dts',
  audioTracks: 1,
  embeddedSubs: [],
})
const fakeThumbnailer: Thumbnailer = async ({ outDir }) => {
  await mkdir(outDir, { recursive: true })
  const p = join(outDir, 'poster.jpg')
  await writeFile(p, 'JPEG')
  return { posterPath: p }
}

describe('Phase 4 — HLS transcode', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let root: string
  let dataDir: string
  let id: string
  const counter = { starts: 0 }

  const fakeStarter: TranscodeStarter = ({ outDir, onExit }) => {
    counter.starts++
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      join(outDir, 'index.m3u8'),
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:4.000,\nseg_00000.ts\n#EXT-X-ENDLIST\n',
    )
    writeFileSync(join(outDir, 'seg_00000.ts'), 'TSDATA')
    onExit(0)
    return { kill: () => {} }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-hls-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-hlsdata-'))
    await mkdir(join(root, 'Movies'), { recursive: true })
    await writeFile(join(root, 'Movies', 'film.mkv'), 'x')

    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer, transcodeStarter: fakeStarter },
    )
    await app.ready()
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-pass-123' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
    const create = await app.inject({ method: 'POST', url: '/api/admin/repositories', cookies, payload: { name: 'M', rootPath: root, type: 'video' } })
    await app.inject({ method: 'POST', url: `/api/admin/repositories/${create.json().id}/scan`, cookies, payload: {} })
    await app.worker.onIdle()
    id = (await app.inject({ method: 'GET', url: '/api/media', cookies })).json().data[0].id
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('routes a non-friendly file to HLS in the playback descriptor', async () => {
    const d = (await app.inject({ method: 'GET', url: `/api/media/${id}/playback`, cookies })).json()
    expect(d.mode).toBe('hls')
    expect(d.url).toBe(`/api/media/${id}/hls/master.m3u8`)
  })

  it('serves a master playlist and starts a transcode', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/media/${id}/hls/master.m3u8`, cookies })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('mpegurl')
    expect(res.body).toContain('index.m3u8')
    expect(counter.starts).toBe(1)
  })

  it('serves the media playlist and segments', async () => {
    const pl = await app.inject({ method: 'GET', url: `/api/media/${id}/hls/index.m3u8`, cookies })
    expect(pl.statusCode).toBe(200)
    expect(pl.body).toContain('#EXT-X-ENDLIST')
    const seg = await app.inject({ method: 'GET', url: `/api/media/${id}/hls/seg_00000.ts`, cookies })
    expect(seg.statusCode).toBe(200)
    expect(seg.headers['content-type']).toBe('video/mp2t')
    expect(seg.body).toBe('TSDATA')
  })

  it('rejects bogus segment names', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/media/${id}/hls/evil.txt`, cookies })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: `/api/media/${id}/hls/..%2f..%2fsecret`, cookies })).statusCode).toBe(400)
  })

  it('reuses the cached transcode (single-flight — no second ffmpeg)', async () => {
    await app.inject({ method: 'GET', url: `/api/media/${id}/hls/master.m3u8`, cookies })
    expect(counter.starts).toBe(1) // completed transcode reused, not restarted
  })

  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/media/${id}/hls/master.m3u8` })).statusCode).toBe(401)
  })
})
