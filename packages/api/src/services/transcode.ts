import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import type { FastifyBaseLogger } from 'fastify'

export interface TranscodeHandle {
  kill: () => void
}

/** Starts an HLS transcode writing into `outDir`; injected so the manager is testable. */
export type TranscodeStarter = (input: {
  absPath: string
  outDir: string
  onExit: (code: number | null) => void
}) => TranscodeHandle

interface ActiveTranscode {
  handle: TranscodeHandle
  lastAccess: number
}

/**
 * On-the-fly HLS transcode manager (media pipeline §8). Single-flight per item: a second
 * request for a transcode already running (or completed in cache) does not start a new
 * ffmpeg. Completed transcodes (`#EXT-X-ENDLIST` present) are reused from disk. Idle
 * transcodes are killed by a periodic sweep, and the on-disk cache is LRU-evicted past
 * `maxCacheBytes` (recency = the playlist's mtime, bumped on every cache reuse).
 */
export class TranscodeManager {
  private readonly active = new Map<string, ActiveTranscode>()
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly dataDir: string,
    private readonly starter: TranscodeStarter,
    private readonly log: FastifyBaseLogger,
    private readonly opts: { idleMs: number; sweep: boolean; maxCacheBytes?: number } = {
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

  private isComplete(outDir: string): boolean {
    const playlist = join(outDir, 'index.m3u8')
    return existsSync(playlist) && readFileSync(playlist, 'utf8').includes('#EXT-X-ENDLIST')
  }

  /** Ensure a transcode exists for `id`; returns its output dir. Single-flight. */
  ensure(id: string, absPath: string): string {
    const outDir = this.outDirFor(id)
    const running = this.active.get(id)
    if (running) {
      running.lastAccess = Date.now()
      return outDir
    }
    if (this.isComplete(outDir)) {
      // Bump the playlist mtime: it is the LRU recency stamp for cache eviction.
      try {
        const now = new Date()
        utimesSync(join(outDir, 'index.m3u8'), now, now)
      } catch {
        /* best-effort */
      }
      return outDir // reuse cached transcode
    }

    mkdirSync(outDir, { recursive: true })
    const handle = this.starter({
      absPath,
      outDir,
      onExit: (code) => {
        this.active.delete(id)
        if (code !== 0 && code !== null) this.log.warn(`transcode ${id} exited ${code}`)
      },
    })
    this.active.set(id, { handle, lastAccess: Date.now() })
    return outDir
  }

  touch(id: string): void {
    const a = this.active.get(id)
    if (a) a.lastAccess = Date.now()
  }

  private sweepIdle(): void {
    const now = Date.now()
    for (const [id, a] of this.active) {
      if (now - a.lastAccess > this.opts.idleMs) {
        a.handle.kill()
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
        total -= e.bytes
        this.log.info(`evicted HLS cache for ${e.id} (${Math.round(e.bytes / 1024)} KB, LRU)`)
      } catch {
        /* in use on Windows or already gone — retry next sweep */
      }
    }
  }

  async stopAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    for (const a of this.active.values()) a.handle.kill()
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
): string[] {
  return [
    '-nostdin', '-v', 'error',
    '-i', absPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    // -2 keeps the width even (codec requirement); min() never upscales smaller sources.
    ...(q.maxHeight > 0 ? ['-vf', `scale=-2:'min(ih,${q.maxHeight})'`] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-maxrate', `${q.maxrateMbps}M`, '-bufsize', `${q.maxrateMbps * 2}M`,
    '-threads', String(threads),
    '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_playlist_type', 'event',
    '-hls_segment_type', 'mpegts',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(outDir, 'seg_%05d.ts'),
    join(outDir, 'index.m3u8'),
  ]
}

/** Real ffmpeg-backed HLS starter (media pipeline §8). No shell. */
export function createTranscodeStarter(ffmpegPath = 'ffmpeg', quality?: TranscodeQuality): TranscodeStarter {
  // Cap encoder threads to half the cores (min 2): an uncapped libx264 grabs every core, so a
  // second concurrent viewer (or any other ffmpeg work) starves and playback stutters for both.
  const threads = Math.max(2, Math.floor(availableParallelism() / 2))
  return ({ absPath, outDir, onExit }) => {
    const args = buildHlsArgs(absPath, outDir, threads, quality)
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
