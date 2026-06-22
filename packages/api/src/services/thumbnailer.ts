import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface ThumbnailInput {
  absPath: string
  type: 'video' | 'image'
  durationS: number | null
  outDir: string
}
export interface ThumbnailResult {
  posterPath: string
}
export type Thumbnailer = (input: ThumbnailInput) => Promise<ThumbnailResult>

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false })
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`)),
    )
  })
}

/** Real ffmpeg-backed thumbnailer (media pipeline §5). No shell. */
export function createThumbnailer(ffmpegPath = 'ffmpeg'): Thumbnailer {
  return async ({ absPath, type, durationS, outDir }) => {
    await mkdir(outDir, { recursive: true })
    const poster = join(outDir, 'poster.jpg')
    const args = ['-nostdin', '-v', 'error', '-y']
    // For video, grab a frame ~10% in to avoid black intros.
    if (type === 'video' && durationS && durationS > 1) {
      args.push('-ss', (durationS * 0.1).toFixed(3))
    }
    args.push('-i', absPath, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', poster)
    await run(ffmpegPath, args)
    return { posterPath: poster }
  }
}
