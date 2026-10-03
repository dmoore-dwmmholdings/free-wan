import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { FastifyBaseLogger } from 'fastify'
import type { Prober } from './ffprobe'
import { mkvKeyframes } from '../lib/mkv-cues'

/** HLS segment length. Short, so the first segment is ready soon after pressing play. */
export const SEGMENT_S = 3
/** A segment this many past what a running encode has written is waited for; further, it restarts. */
const WAIT_AHEAD = 3

/** A remux's segments this long or longer mean an index too sparse to trust. */
const MAX_COPY_SEGMENT_S = 30

/**
 * How a video becomes HLS.
 * - `vod`: the whole playlist is written up front, so a player can seek anywhere at once. A
 *   segment requested far from the running ffmpeg restarts it there. With `copyStarts` the video
 *   is remuxed as is, cut at those keyframes (seconds); otherwise it is encoded, cut every
 *   SEGMENT_S.
 * - `event`: ffmpeg encodes and writes a growing playlist, for when the duration is unknown.
 */
export type HlsPlan =
  | { kind: 'vod'; segments: number; durationS: number; copyStarts?: number[] }
  | { kind: 'event'; durationS: null }

export interface HlsSource {
  videoCodec?: string
  pixFmt?: string
}

/** `keyframes` are the source's, from its index, when it has one. */
export function planHls(durationS: number | null | undefined, source?: HlsSource, keyframes?: number[] | null): HlsPlan {
  if (!durationS || durationS <= 0) return { kind: 'event', durationS: null }
  const starts = source && canCopyVideo(source) && keyframes ? copyStarts(keyframes, durationS) : null
  if (starts) return { kind: 'vod', segments: starts.length, durationS, copyStarts: starts }
  return { kind: 'vod', segments: segmentCount(durationS), durationS }
}

/** 8-bit 4:2:0 H.264 plays everywhere as is; 10-bit or 4:2:2 H.264 does not on Apple devices. */
function canCopyVideo(s: HlsSource): boolean {
  return s.videoCodec === 'h264' && (s.pixFmt === 'yuv420p' || s.pixFmt === 'yuvj420p')
}

/**
 * Segment start times for a remux: the first keyframe, then each next keyframe at least
 * SEGMENT_S on. Null when the keyframes do not cover the video closely enough to cut it well.
 */
export function copyStarts(keyframes: number[], durationS: number): number[] | null {
  const starts: number[] = []
  for (const k of keyframes) {
    if (k >= durationS - 0.25) break
    if (starts.length === 0 || k - starts[starts.length - 1]! >= SEGMENT_S) starts.push(k)
  }
  if (starts.length === 0 || starts[0]! > 0.5) return null
  for (let i = 0; i < starts.length; i++) {
    if ((starts[i + 1] ?? durationS) - starts[i]! > MAX_COPY_SEGMENT_S) return null
  }
  return starts
}

/** A tail under a quarter second joins the last segment rather than being one of its own. */
export function segmentCount(durationS: number): number {
  return Math.max(1, Math.ceil((durationS - 0.25) / SEGMENT_S))
}

export function segmentName(n: number): string {
  return `seg_${String(n).padStart(5, '0')}.ts`
}

/** Where each segment of a `vod` plan starts, in seconds; the first always at 0. */
function segmentStarts(plan: { segments: number; copyStarts?: number[] }): number[] {
  return Array.from({ length: plan.segments }, (_, i) => (i === 0 ? 0 : plan.copyStarts?.[i] ?? i * SEGMENT_S))
}

/** The whole playlist of a `vod` plan, before any segment exists. */
export function vodPlaylist(plan: { segments: number; durationS: number; copyStarts?: number[] }): string {
  const starts = segmentStarts(plan)
  const lengths = starts.map((start, i) => (starts[i + 1] ?? plan.durationS) - start)
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    `#EXT-X-TARGETDURATION:${Math.max(1, Math.round(Math.max(...lengths)))}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ]
  lengths.forEach((length, i) => lines.push(`#EXTINF:${length.toFixed(3)},`, segmentName(i)))
  lines.push('#EXT-X-ENDLIST', '')
  return lines.join('\n')
}

export interface TranscodeHandle {
  kill: () => void
}

/** What one ffmpeg run writes: see `buildHlsArgs`. */
export interface HlsRunOptions {
  /** Remux, cutting at these keyframes: a `vod` plan's `copyStarts`. */
  copyStarts?: number[]
  /** The segment to start at; past 0 the run seeks there first. */
  startSegment?: number
  /** Leave index.m3u8 alone: a `vod` plan's playlist is written by the manager. */
  vod?: boolean
}

/** Starts an HLS transcode writing into `outDir`; injected so the manager is testable. */
export type TranscodeStarter = (input: {
  absPath: string
  outDir: string
  options: HlsRunOptions
  onExit: (code: number | null) => void
}) => TranscodeHandle

interface ActiveTranscode {
  handle?: TranscodeHandle
  lastAccess: number
  startedAt: number
  /** Where ffmpeg writes. A remux writes beside the cache and its segments move in once whole. */
  dir: string
  /** The first segment this run writes, and the first at or after it that it has not yet written. */
  start: number
  next: number
}

/**
 * On-the-fly HLS transcode manager (media pipeline §8). One ffmpeg per item at a time: a second
 * request for a transcode already running (or completed in cache) does not start another.
 * Completed transcodes are reused from disk. Idle transcodes are killed by a periodic sweep,
 * and the on-disk cache is LRU-evicted past `maxCacheBytes` (recency = the playlist's mtime,
 * bumped on every reuse).
 */
export class TranscodeManager {
  private readonly active = new Map<string, ActiveTranscode>()
  private readonly plans = new Map<string, HlsPlan>()
  private readonly opening = new Map<string, Promise<HlsPlan>>()
  /** The newest segment request per item, by sequence number. */
  private readonly requests = new Map<string, number>()
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly dataDir: string,
    private readonly starter: TranscodeStarter,
    private readonly log: FastifyBaseLogger,
    private readonly opts: { idleMs: number; sweep: boolean; maxCacheBytes?: number; prober?: Prober } = {
      idleMs: 60_000,
      sweep: true,
    },
  ) {
    if (opts.sweep) {
      this.timer = setInterval(() => {
        this.sweepIdle()
        this.enforceCacheCap()
      }, 15_000)
      this.timer.unref?.()
    }
  }

  outDirFor(id: string): string {
    return join(this.dataDir, 'hls', id)
  }

  /** A `vod` plan is complete once every segment exists; an `event` one once ffmpeg ends its playlist. */
  private isComplete(id: string, plan: HlsPlan): boolean {
    const outDir = this.outDirFor(id)
    if (plan.kind === 'vod') return existsSync(join(outDir, 'complete'))
    const playlist = join(outDir, 'index.m3u8')
    return existsSync(playlist) && readFileSync(playlist, 'utf8').includes('#EXT-X-ENDLIST')
  }

  /** The item's plan, from memory or from its cache directory. */
  planFor(id: string): HlsPlan | undefined {
    const file = join(this.outDirFor(id), 'plan.json')
    const known = this.plans.get(id)
    // The cache directory can be cleared from outside; a plan without it is gone too.
    if (known && existsSync(file)) return known
    this.plans.delete(id)
    try {
      const plan = JSON.parse(readFileSync(file, 'utf8')) as HlsPlan
      this.plans.set(id, plan)
      return plan
    } catch {
      return undefined
    }
  }

  private savePlan(id: string, plan: HlsPlan): void {
    const outDir = this.outDirFor(id)
    mkdirSync(outDir, { recursive: true })
    if (plan.kind === 'vod') writeFileSync(join(outDir, 'index.m3u8'), vodPlaylist(plan))
    writeFileSync(join(outDir, 'plan.json'), JSON.stringify(plan))
    this.plans.set(id, plan)
  }

  /**
   * Plans an item's HLS on its first play and starts the transcode unless it is running or done.
   * Later calls reuse the plan. Probing the source for the plan happens once, here.
   */
  async open(id: string, absPath: string, durationS: number | null): Promise<HlsPlan> {
    const pending = this.opening.get(id)
    if (pending) return pending
    const opening = this.openNow(id, absPath, durationS).finally(() => this.opening.delete(id))
    this.opening.set(id, opening)
    return opening
  }

  private async openNow(id: string, absPath: string, durationS: number | null): Promise<HlsPlan> {
    const outDir = this.outDirFor(id)
    let plan = this.planFor(id)
    if (!plan) {
      // A transcode cached before plans existed is a complete `event` one, or a fragment to drop.
      const legacy: HlsPlan = { kind: 'event', durationS: null }
      if (existsSync(outDir) && this.isComplete(id, legacy)) {
        plan = legacy
        this.plans.set(id, plan)
      } else {
        rmSync(outDir, { recursive: true, force: true })
        const source = await this.opts.prober?.(absPath).catch(() => undefined)
        const keyframes = source?.videoCodec === 'h264' ? await mkvKeyframes(absPath).catch(() => null) : null
        plan = planHls(durationS, source, keyframes)
        this.savePlan(id, plan)
      }
    }
    try {
      // Bump the playlist mtime: it is the LRU recency stamp for cache eviction.
      const now = new Date()
      utimesSync(join(outDir, 'index.m3u8'), now, now)
    } catch {
      /* not written yet */
    }
    const run = this.active.get(id)
    if (run) run.lastAccess = Date.now()
    else if (!this.isComplete(id, plan) && !(plan.kind === 'vod' && existsSync(join(outDir, segmentName(0))))) {
      this.startRun(id, absPath, plan, 0)
    }
    return plan
  }

  /** Starts ffmpeg for `plan` at segment `start`, replacing any run the item has. */
  private startRun(id: string, absPath: string, plan: HlsPlan, start: number): void {
    this.active.get(id)?.handle?.kill()
    const outDir = this.outDirFor(id)
    const copyStarts = plan.kind === 'vod' ? plan.copyStarts : undefined
    // The segment muxer a remux uses has no temp files, so its run writes into a directory of
    // its own and each segment moves into the cache once whole.
    const now = Date.now()
    const dir = copyStarts ? join(outDir, `run-${start}-${now}`) : outDir
    mkdirSync(dir, { recursive: true })
    const run: ActiveTranscode = { lastAccess: now, startedAt: now, dir, start, next: start }
    // Registered before starting: a starter may report its exit straight away.
    this.active.set(id, run)
    run.handle = this.starter({
      absPath,
      outDir: dir,
      options: { copyStarts, startSegment: start, vod: plan.kind === 'vod' },
      onExit: (code) => this.exited(id, run, code, absPath),
    })
  }

  /** Moves a remux run's whole segments into the cache: those it has moved past, or all once done. */
  private promote(id: string, run: ActiveTranscode, finished = false): void {
    const outDir = this.outDirFor(id)
    if (run.dir === outDir) return
    let names: string[]
    try {
      names = readdirSync(run.dir).filter((f) => /^seg_\d+\.ts$/.test(f)).sort()
    } catch {
      return
    }
    names.forEach((name, i) => {
      if (!finished && i === names.length - 1) return // still being written
      try {
        renameSync(join(run.dir, name), join(outDir, name))
      } catch {
        /* raced with the run's own cleanup */
      }
    })
  }

  private exited(id: string, run: ActiveTranscode, code: number | null, absPath: string): void {
    if (this.active.get(id) === run) this.active.delete(id)
    if (code !== 0 && code !== null) this.log.warn(`transcode ${id} exited ${code}`)
    const outDir = this.outDirFor(id)
    this.promote(id, run, code === 0)
    if (run.dir !== outDir) rmSync(run.dir, { recursive: true, force: true })
    const plan = this.planFor(id)
    if (code === 0 && plan?.kind === 'vod') {
      let all = true
      for (let n = 0; n < plan.segments && all; n++) all = existsSync(join(outDir, segmentName(n)))
      if (all) writeFileSync(join(outDir, 'complete'), '')
    }
    // A remux ffmpeg refused (an odd stream): encode instead. The next play gets the encode's
    // playlist; this one carries on as best it can.
    if (plan?.kind === 'vod' && plan.copyStarts && code !== 0 && code !== null &&
        !existsSync(join(outDir, segmentName(run.start)))) {
      const fallback = planHls(plan.durationS)
      this.savePlan(id, fallback)
      this.startRun(id, absPath, fallback, run.start)
    }
  }

  /**
   * Resolves once segment `n` of a `vod` plan exists, restarting the encode there when it is not
   * running or is too far away. False when it never appeared, or the plan is not `vod`.
   */
  async segment(id: string, n: number, absPath: string, signal?: AbortSignal, timeoutMs = 30_000): Promise<boolean> {
    const plan = this.planFor(id)
    if (plan?.kind !== 'vod' || n < 0 || n >= plan.segments) return false
    const file = join(this.outDirFor(id), segmentName(n))
    const seq = (this.requests.get(id) ?? 0) + 1
    this.requests.set(id, seq)
    const deadline = Date.now() + timeoutMs
    let started = false
    while (!signal?.aborted && Date.now() < deadline) {
      const run = this.active.get(id)
      if (run) {
        run.lastAccess = Date.now()
        this.promote(id, run)
      }
      if (existsSync(file)) return true
      // Only the newest request moves the encode: an older one is a position the player has left.
      if (this.requests.get(id) === seq && !(run && this.reaches(id, run, n))) {
        if (started && !run) return false // the run started for this segment ended without it
        this.startRun(id, absPath, plan, n)
        started = true
      }
      await delay(100)
    }
    return existsSync(file)
  }

  /** Whether `run` will write segment `n` soon. Segments left by earlier runs do not count. */
  private reaches(id: string, run: ActiveTranscode, n: number): boolean {
    const outDir = this.outDirFor(id)
    for (;;) {
      try {
        if (statSync(join(outDir, segmentName(run.next))).mtimeMs < run.startedAt) break
        run.next++
      } catch {
        break
      }
    }
    return n >= run.start && n <= run.next + WAIT_AHEAD
  }

  touch(id: string): void {
    const a = this.active.get(id)
    if (a) a.lastAccess = Date.now()
  }

  private sweepIdle(): void {
    const now = Date.now()
    for (const [id, a] of this.active) {
      if (now - a.lastAccess > this.opts.idleMs) {
        a.handle?.kill()
        this.active.delete(id)
      }
    }
  }

  /**
   * LRU size-cap eviction (NFR: the HLS cache must not grow unbounded). Walks
   * `data/hls/*`, skips in-flight transcodes, and removes the least-recently-used
   * completed ones until the total is back under `maxCacheBytes`. Public so tests
   * (and shutdown paths) can invoke it directly. No-op when the cap is 0/unset.
   */
  enforceCacheCap(): void {
    const max = this.opts.maxCacheBytes ?? 0
    if (max <= 0) return
    const hlsRoot = join(this.dataDir, 'hls')
    if (!existsSync(hlsRoot)) return

    interface Entry {
      id: string
      dir: string
      bytes: number
      lastUsed: number
    }
    const entries: Entry[] = []
    let total = 0
    for (const id of readdirSync(hlsRoot)) {
      if (this.active.has(id)) continue // never evict an in-flight transcode
      const dir = join(hlsRoot, id)
      let bytes = 0
      let playlistMtime = 0
      let newestMtime = 0
      try {
        if (!statSync(dir).isDirectory()) continue
        for (const f of readdirSync(dir)) {
          const st = statSync(join(dir, f))
          bytes += st.size
          if (f === 'index.m3u8') playlistMtime = st.mtimeMs
          if (st.mtimeMs > newestMtime) newestMtime = st.mtimeMs
        }
      } catch {
        continue // raced with a concurrent delete — skip
      }
      // The playlist mtime is the access stamp (bumped in ensure()); incomplete
      // leftovers without one fall back to their newest file.
      entries.push({ id, dir, bytes, lastUsed: playlistMtime || newestMtime })
      total += bytes
    }
    if (total <= max) return

    entries.sort((a, b) => a.lastUsed - b.lastUsed) // oldest first
    for (const e of entries) {
      if (total <= max) break
      try {
        rmSync(e.dir, { recursive: true, force: true })
        this.plans.delete(e.id)
        total -= e.bytes
        this.log.info(`evicted HLS cache for ${e.id} (${Math.round(e.bytes / 1024)} KB, LRU)`)
      } catch {
        /* in use on Windows or already gone — retry next sweep */
      }
    }
  }

  async stopAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    for (const a of this.active.values()) a.handle?.kill()
    this.active.clear()
  }

  activeCount(): number {
    return this.active.size
  }
}

export interface TranscodeQuality {
  /** Downscale to at most this height (0 = keep the source resolution). */
  maxHeight: number
  /** x264 maxrate cap in Mbps. */
  maxrateMbps: number
}

/**
 * The single HLS rendition's ffmpeg argv (exported for tests). One rendition, not a
 * multi-bitrate ladder: on a CPU-only home server a ladder multiplies encode cost per
 * viewer; these caps let a slow remote link trade resolution for smoothness instead.
 */
export function buildHlsArgs(
  absPath: string,
  outDir: string,
  threads: number,
  q: TranscodeQuality = { maxHeight: 0, maxrateMbps: 6 },
  run: HlsRunOptions = {},
): string[] {
  const start = run.startSegment ?? 0
  // The source's own timestamps, shifted by a constant that keeps them positive: every run
  // stamps a frame the same, so segments from different runs join up.
  const timestamps = ['-copyts', '-start_at_zero', '-output_ts_offset', '10']
  const audio = ['-c:a', 'aac', '-ac', '2', '-b:a', '160k']
  if (run.copyStarts) {
    const from = start > 0 ? run.copyStarts[start]! : 0
    // Split points count from where this run starts; a hair early, so rounding cannot miss the
    // keyframe they name.
    const splits = run.copyStarts.slice(start + 1).map((t) => (t - from - 0.01).toFixed(3))
    return [
      '-nostdin', '-v', 'error',
      // Just past the keyframe: a stream-copy seek starts at the keyframe at or before this.
      ...(start > 0 ? ['-ss', (from + 0.001).toFixed(3)] : []),
      '-i', absPath,
      ...timestamps,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy',
      ...audio,
      '-f', 'segment',
      '-segment_format', 'mpegts',
      ...(splits.length > 0 ? ['-segment_times', splits.join(',')] : []),
      '-segment_start_number', String(start),
      join(outDir, 'seg_%05d.ts'),
    ]
  }
  const video = [
    // -2 keeps the width even (codec requirement); min() never upscales smaller sources.
    ...(q.maxHeight > 0 ? ['-vf', `scale=-2:'min(ih,${q.maxHeight})'`] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    // 8-bit: a 10-bit source would otherwise encode to High 10, which Apple devices cannot play.
    '-pix_fmt', 'yuv420p',
    // Keyframes on the segment grid and nowhere else, so every run cuts the same segments
    // wherever it starts.
    '-sc_threshold', '0', '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_S})`,
    '-maxrate', `${q.maxrateMbps}M`, '-bufsize', `${q.maxrateMbps * 2}M`,
    '-threads', String(threads),
  ]
  return [
    '-nostdin', '-v', 'error',
    ...(start > 0 ? ['-ss', String(start * SEGMENT_S)] : []),
    '-i', absPath,
    ...timestamps,
    '-map', '0:v:0', '-map', '0:a:0?',
    ...video,
    ...audio,
    '-f', 'hls',
    // Just under the segment length, so each cut lands on the next forced keyframe even when a
    // run's first frame falls a little after its grid point.
    '-hls_time', String(SEGMENT_S - 0.5),
    '-hls_playlist_type', 'event',
    '-hls_segment_type', 'mpegts',
    // temp_file: a segment appears under its name only once complete, so existing means ready.
    '-hls_flags', 'independent_segments+temp_file',
    '-start_number', String(start),
    '-hls_segment_filename', join(outDir, 'seg_%05d.ts'),
    join(outDir, run.vod ? 'ffmpeg.m3u8' : 'index.m3u8'),
  ]
}

/** Real ffmpeg-backed HLS starter (media pipeline §8). No shell. */
export function createTranscodeStarter(ffmpegPath = 'ffmpeg', quality?: TranscodeQuality): TranscodeStarter {
  // Cap encoder threads to half the cores (min 2): an uncapped libx264 grabs every core, so a
  // second concurrent viewer (or any other ffmpeg work) starves and playback stutters for both.
  const threads = Math.max(2, Math.floor(availableParallelism() / 2))
  return ({ absPath, outDir, options, onExit }) => {
    const args = buildHlsArgs(absPath, outDir, threads, quality, options)
    const child = spawn(ffmpegPath, args, { shell: false })
    child.stderr.on('data', () => {}) // drained; errors surface via exit code
    child.on('close', (code) => onExit(code))
    child.on('error', () => onExit(1))
    return {
      kill: () => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      },
    }
  }
}
