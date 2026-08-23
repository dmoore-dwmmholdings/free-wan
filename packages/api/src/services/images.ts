import { spawn } from 'node:child_process'
import { renameSync } from 'node:fs'

/** Produces a downscaled JPEG variant of an image. Injected so the route is testable. */
export type ImageVariantMaker = (input: {
  absPath: string
  width: number
  outPath: string
}) => Promise<void>

/** Real ffmpeg-backed image resizer (media pipeline §5 gallery variants). No shell. */
export function createImageVariantMaker(ffmpegPath = 'ffmpeg'): ImageVariantMaker {
  return ({ absPath, width, outPath }) =>
    new Promise<void>((resolve, reject) => {
      // Write to a temp name, rename on success: outPath never exists half-written
      // (a crash mid-write must not leave a truncated JPEG that gets served forever).
      const tmpPath = `${outPath}.part.jpg`
      const args = [
        '-nostdin', '-v', 'error', '-y',
        '-i', absPath,
        '-vf', `scale=${width}:-2`,
        '-q:v', '4',
        tmpPath,
      ]
      const child = spawn(ffmpegPath, args, { shell: false })
      let err = ''
      child.stderr.on('data', (d) => (err += d))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`))
        try {
          renameSync(tmpPath, outPath)
          resolve()
        } catch (e) {
          reject(e as Error)
        }
      })
    })
}
