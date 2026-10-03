import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'
import { mkvKeyframes } from '../src/lib/mkv-cues'
import {
  TranscodeManager,
  buildHlsArgs,
  copyStarts,
  planHls,
  segmentName,
  vodPlaylist,
  type HlsRunOptions,
  type TranscodeStarter,
} from '../src/services/transcode'

const here = dirname(fileURLToPath(import.meta.url))

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

  const fakeStarter: TranscodeStarter = ({ outDir, options, onExit }) => {
    counter.starts++
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      join(outDir, options.vod ? 'ffmpeg.m3u8' : 'index.m3u8'),
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

  it('serves the whole seekable playlist up front, and segments', async () => {
    const pl = await app.inject({ method: 'GET', url: `/api/media/${id}/hls/index.m3u8`, cookies })
    expect(pl.statusCode).toBe(200)
    expect(pl.body).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(pl.body).toContain('seg_00019.ts') // 60 s in 3 s segments
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

describe('transcode cache size-cap eviction (LRU)', () => {
  const PLAYLIST = '#EXTM3U\n#EXT-X-ENDLIST\n'
  const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as import('fastify').FastifyBaseLogger

  function seedCached(dataDir: string, id: string, segBytes: number, mtime: Date): number {
    const dir = join(dataDir, 'hls', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.m3u8'), PLAYLIST)
    writeFileSync(join(dir, 'seg_00000.ts'), 'X'.repeat(segBytes))
    utimesSync(join(dir, 'index.m3u8'), mtime, mtime)
    utimesSync(join(dir, 'seg_00000.ts'), mtime, mtime)
    return PLAYLIST.length + segBytes
  }

  it('evicts the least-recently-used completed transcodes past the cap', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fw-hlscap-'))
    try {
      const size = seedCached(dataDir, 'old', 100, new Date(Date.now() - 3 * 3600_000))
      seedCached(dataDir, 'mid', 100, new Date(Date.now() - 2 * 3600_000))
      seedCached(dataDir, 'new', 100, new Date(Date.now() - 1 * 3600_000))
      const mgr = new TranscodeManager(dataDir, () => ({ kill: () => {} }), noopLog, {
        idleMs: 60_000,
        sweep: false,
        maxCacheBytes: size * 2, // three cached → must drop exactly the oldest
      })
      mgr.enforceCacheCap()
      expect(existsSync(join(dataDir, 'hls', 'old'))).toBe(false)
      expect(existsSync(join(dataDir, 'hls', 'mid'))).toBe(true)
      expect(existsSync(join(dataDir, 'hls', 'new'))).toBe(true)
      await mgr.stopAll()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('never evicts an in-flight transcode, and reuse bumps LRU recency', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'fw-hlscap2-'))
    try {
      const size = seedCached(dataDir, 'colder', 100, new Date(Date.now() - 3 * 3600_000))
      seedCached(dataDir, 'warmer', 100, new Date(Date.now() - 2 * 3600_000))
      // An in-flight transcode bigger than the whole cap — must survive the sweep.
      const activeStarter: TranscodeStarter = ({ outDir }) => {
        mkdirSync(outDir, { recursive: true })
        writeFileSync(join(outDir, 'index.m3u8'), '#EXTM3U\n') // no ENDLIST — still running
        writeFileSync(join(outDir, 'seg_00000.ts'), 'X'.repeat(10_000))
        return { kill: () => {} }
      }
      const mgr = new TranscodeManager(dataDir, activeStarter, noopLog, {
        idleMs: 60_000,
        sweep: false,
        maxCacheBytes: size + 50, // room for ~one cached dir beside the active one
      })
      await mgr.open('running', '/fake/file.mkv', null) // registers as active
      await mgr.open('colder', '/fake/other.mkv', null) // completed → reused → mtime bumped to now
      mgr.enforceCacheCap()
      expect(existsSync(join(dataDir, 'hls', 'running'))).toBe(true) // active spared
      expect(existsSync(join(dataDir, 'hls', 'colder'))).toBe(true) // freshly reused → kept
      expect(existsSync(join(dataDir, 'hls', 'warmer'))).toBe(false) // now the LRU → evicted
      await mgr.stopAll()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

describe('transcode quality caps (single rendition)', () => {
  it('keeps the source resolution by default (no scale filter)', () => {
    const args = buildHlsArgs('/in.mkv', '/out', 4)
    expect(args).not.toContain('-vf')
    expect(args[args.indexOf('-maxrate') + 1]).toBe('6M')
    expect(args[args.indexOf('-bufsize') + 1]).toBe('12M')
  })

  it('applies TRANSCODE_MAX_HEIGHT / MAXRATE without ever upscaling', () => {
    const args = buildHlsArgs('/in.mkv', '/out', 4, { maxHeight: 720, maxrateMbps: 3 })
    expect(args[args.indexOf('-vf') + 1]).toBe("scale=-2:'min(ih,720)'") // min() → no upscale
    expect(args[args.indexOf('-maxrate') + 1]).toBe('3M')
    expect(args[args.indexOf('-bufsize') + 1]).toBe('6M')
  })
})

describe('HLS plans', () => {
  const everyTwo = Array.from({ length: 30 }, (_, i) => i * 2) // keyframes every 2 s

  it('remuxes 8-bit H.264 with a keyframe index and encodes everything else', () => {
    const h264 = { videoCodec: 'h264', pixFmt: 'yuv420p' }
    expect(planHls(60, h264, everyTwo)).toEqual({
      kind: 'vod', segments: 15, durationS: 60, copyStarts: everyTwo.filter((t) => t % 4 === 0),
    })
    expect(planHls(60, h264, null)).toEqual({ kind: 'vod', segments: 20, durationS: 60 }) // no index
    expect(planHls(60, { videoCodec: 'h264', pixFmt: 'yuv420p10le' }, everyTwo).kind).toBe('vod')
    expect(planHls(60, { videoCodec: 'h264', pixFmt: 'yuv420p10le' }, everyTwo)).not.toHaveProperty('copyStarts')
    expect(planHls(60, { videoCodec: 'hevc', pixFmt: 'yuv420p' }, everyTwo)).toEqual({ kind: 'vod', segments: 20, durationS: 60 })
    expect(planHls(null, h264, everyTwo)).toEqual({ kind: 'event', durationS: null })
    expect(planHls(60).kind).toBe('vod') // not probed
  })

  it('cuts a remux at keyframes, refusing an index that is too sparse or starts late', () => {
    expect(copyStarts([0, 1, 2, 3.5, 4, 7, 7.1], 9)).toEqual([0, 3.5, 7])
    expect(copyStarts([0, 2, 4, 8.9], 9)).toEqual([0, 4]) // a keyframe in the last quarter second starts nothing
    expect(copyStarts([0, 40], 60)).toBeNull() // a 40 s gap
    expect(copyStarts([0, 3], 60)).toBeNull() // the index stops early
    expect(copyStarts([2, 5], 6)).toBeNull() // first keyframe not at the start
  })

  it('lists a remux\'s uneven segments', () => {
    const pl = vodPlaylist({ segments: 3, durationS: 10, copyStarts: [0.04, 4, 8.5] })
    expect(pl.match(/#EXTINF:([\d.]+),/g)).toEqual(['#EXTINF:4.000,', '#EXTINF:4.500,', '#EXTINF:1.500,'])
    expect(pl).toContain('#EXT-X-TARGETDURATION:5')
  })

  it('reads keyframe times from a Matroska index, and nothing from other files', async () => {
    const fixture = join(here, 'fixtures', 'keyframes.mkv')
    expect(await mkvKeyframes(fixture)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(await mkvKeyframes(join(here, 'hls.test.ts'))).toBeNull()
  })

  it('lists every segment, folding a tiny tail into the last', () => {
    const pl = vodPlaylist({ segments: 3, durationS: 7.1 })
    expect(pl.match(/#EXTINF:([\d.]+),/g)).toEqual(['#EXTINF:3.000,', '#EXTINF:3.000,', '#EXTINF:1.100,'])
    expect(planHls(6.2)).toEqual({ kind: 'vod', segments: 2, durationS: 6.2 })
    expect(vodPlaylist({ segments: 2, durationS: 6.2 })).toContain('#EXTINF:3.200,\nseg_00001.ts')
  })

  it('starts a run part way in on the segment grid, with its own playlist', () => {
    const args = buildHlsArgs('/in.mkv', '/out', 4, undefined, { startSegment: 10, vod: true })
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '30'])
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i')) // input seek: fast
    expect(args[args.indexOf('-start_number') + 1]).toBe('10')
    expect(args[args.indexOf('-force_key_frames') + 1]).toBe('expr:gte(t,n_forced*3)')
    expect(args.at(-1)).toBe('/out/ffmpeg.m3u8')
  })

  it('copies the video stream for a remux, splitting at its keyframes from where it starts', () => {
    const args = buildHlsArgs('/in.mkv', '/out', 4, undefined, { copyStarts: [0, 4, 8.5, 12], startSegment: 1, vod: true })
    expect(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2)).toEqual(['-c:v', 'copy'])
    expect(args).not.toContain('libx264')
    expect(args[args.indexOf('-ss') + 1]).toBe('4.001')
    expect(args[args.indexOf('-segment_times') + 1]).toBe('4.490,7.990')
    expect(args[args.indexOf('-segment_start_number') + 1]).toBe('1')
    expect(args.at(-1)).toBe('/out/seg_%05d.ts')
  })
})

describe('seekable transcodes', () => {
  const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as import('fastify').FastifyBaseLogger
  let dataDir: string
  let starts: number[]
  let killed: number
  let exits: Array<(code: number | null) => void>
  let mgr: TranscodeManager

  const starter: TranscodeStarter = ({ options, onExit }: { options: HlsRunOptions; onExit: (code: number | null) => void }) => {
    starts.push(options.startSegment ?? 0)
    exits.push(onExit)
    return { kill: () => killed++ }
  }
  const write = (n: number) => writeFileSync(join(dataDir, 'hls', 'v', segmentName(n)), 'TS')

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'fw-seek-'))
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  async function fresh() {
    await rm(join(dataDir, 'hls'), { recursive: true, force: true })
    starts = []
    killed = 0
    exits = []
    mgr = new TranscodeManager(dataDir, starter, noopLog, { idleMs: 60_000, sweep: false })
    await mgr.open('v', '/src.mkv', 300) // 100 segments, encode starts at 0
  }

  it('waits for a segment the running encode is about to write', async () => {
    await fresh()
    const waiting = mgr.segment('v', 1, '/src.mkv')
    write(0)
    write(1)
    expect(await waiting).toBe(true)
    expect(starts).toEqual([0])
    await mgr.stopAll()
  })

  it('restarts the encode at a segment far ahead, replacing the old run', async () => {
    await fresh()
    const waiting = mgr.segment('v', 60, '/src.mkv')
    await new Promise((r) => setTimeout(r, 150))
    expect(starts).toEqual([0, 60])
    expect(killed).toBe(1)
    write(60)
    expect(await waiting).toBe(true)
    await mgr.stopAll()
  })

  it('serves segments already on disk without starting anything', async () => {
    await fresh()
    write(40)
    expect(await mgr.segment('v', 40, '/src.mkv')).toBe(true)
    expect(starts).toEqual([0])
    await mgr.stopAll()
  })

  it('lets only the newest request move the encode', async () => {
    await fresh()
    const left = new AbortController()
    const old = mgr.segment('v', 30, '/src.mkv', left.signal)
    await new Promise((r) => setTimeout(r, 150))
    const newest = mgr.segment('v', 80, '/src.mkv')
    await new Promise((r) => setTimeout(r, 350))
    expect(starts).toEqual([0, 30, 80]) // the old request did not drag it back to 30
    left.abort()
    expect(await old).toBe(false)
    write(80)
    expect(await newest).toBe(true)
    await mgr.stopAll()
  })

  it('gives up when the run started for a segment ends without it', async () => {
    await fresh()
    const waiting = mgr.segment('v', 70, '/src.mkv')
    await new Promise((r) => setTimeout(r, 150))
    exits.at(-1)!(1)
    expect(await waiting).toBe(false)
    await mgr.stopAll()
  })

  it('moves a remux run\'s segments into the cache once each is whole', async () => {
    await rm(join(dataDir, 'hls'), { recursive: true, force: true })
    starts = []
    exits = []
    const dirs: string[] = []
    const remux = new TranscodeManager(dataDir, (input) => {
      dirs.push(input.outDir)
      return starter(input)
    }, noopLog, { idleMs: 60_000, sweep: false })
    // A remux plan, as the prober and index would give for an H.264 MKV.
    mkdirSync(join(dataDir, 'hls', 'v'), { recursive: true })
    writeFileSync(join(dataDir, 'hls', 'v', 'plan.json'), JSON.stringify({ kind: 'vod', segments: 3, durationS: 12, copyStarts: [0, 4, 8] }))
    await remux.open('v', '/src.mkv', 12)
    expect(dirs[0]).not.toBe(join(dataDir, 'hls', 'v')) // a run directory of its own
    writeFileSync(join(dirs[0]!, segmentName(0)), 'TS')
    const waiting = remux.segment('v', 0, '/src.mkv', undefined, 400)
    await new Promise((r) => setTimeout(r, 150))
    expect(existsSync(join(dataDir, 'hls', 'v', segmentName(0)))).toBe(false) // may still be growing
    writeFileSync(join(dirs[0]!, segmentName(1)), 'TS')
    expect(await waiting).toBe(true) // seg 1 began, so seg 0 is whole
    writeFileSync(join(dirs[0]!, segmentName(2)), 'TS')
    exits[0]!(0)
    expect(existsSync(join(dataDir, 'hls', 'v', segmentName(2)))).toBe(true) // done: the last is whole too
    expect(existsSync(dirs[0]!)).toBe(false)
    expect(existsSync(join(dataDir, 'hls', 'v', 'complete'))).toBe(true)
    await remux.stopAll()
  })

  it('marks the cache complete once every segment exists', async () => {
    await fresh()
    for (let n = 0; n < 100; n++) write(n)
    exits[0]!(0)
    expect(existsSync(join(dataDir, 'hls', 'v', 'complete'))).toBe(true)
    await mgr.open('v', '/src.mkv', 300)
    expect(starts).toEqual([0]) // complete: reused, not restarted
    await mgr.stopAll()
  })
})
