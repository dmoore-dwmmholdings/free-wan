import { spawn } from 'node:child_process'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Total size in bytes of a directory tree (0 if missing/unreadable). */
export function dirSizeBytes(path: string): number {
  if (!existsSync(path)) return 0
  let total = 0
  const walk = (p: string): void => {
    let entries
    try {
      entries = readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(p, e.name)
      try {
        if (e.isDirectory()) walk(full)
        else if (e.isFile()) total += statSync(full).size
      } catch {
        /* vanished */
      }
    }
  }
  walk(path)
  return total
}

/** ffmpeg version string, or null if ffmpeg is unavailable. */
export function ffmpegVersion(ffmpegPath = 'ffmpeg'): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(ffmpegPath, ['-version'], { shell: false })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.on('error', () => resolve(null))
      child.on('close', (code) => {
        if (code !== 0) return resolve(null)
        const m = /ffmpeg version (\S+)/.exec(out)
        resolve(m ? m[1]! : (out.split('\n')[0] ?? null))
      })
    } catch {
      resolve(null)
    }
  })
}
