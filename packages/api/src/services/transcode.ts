import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
 * transcodes are killed by a periodic sweep.
 */
export class TranscodeManager {
  private readonly active = new Map<string, ActiveTranscode>()
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly dataDir: string,
    private readonly starter: TranscodeStarter,
    private readonly log: FastifyBaseLogger,
    private readonly opts: { idleMs: number; sweep: boolean } = { idleMs: 60_000, sweep: true },
  ) {
    if (opts.sweep) {
      this.timer = setInterval(() => this.sweepIdle(), 15_000)
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
    if (this.isComplete(outDir)) return outDir // reuse cached transcode

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

  async stopAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    for (const a of this.active.values()) a.handle.kill()
    this.active.clear()
  }

  activeCount(): number {
    return this.active.size
  }
}

/** Real ffmpeg-backed HLS starter (media pipeline §8). No shell. */
export function createTranscodeStarter(ffmpegPath = 'ffmpeg'): TranscodeStarter {
  return ({ absPath, outDir, onExit }) => {
    const args = [
      '-nostdin', '-v', 'error',
      '-i', absPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', '6M', '-bufsize', '12M',
      '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_playlist_type', 'event',
      '-hls_segment_type', 'mpegts',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', join(outDir, 'seg_%05d.ts'),
      join(outDir, 'index.m3u8'),
    ]
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
