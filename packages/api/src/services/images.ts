import { spawn } from 'node:child_process'

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
      const args = [
        '-nostdin', '-v', 'error', '-y',
        '-i', absPath,
        '-vf', `scale=${width}:-2`,
        '-q:v', '4',
        outPath,
      ]
      const child = spawn(ffmpegPath, args, { shell: false })
      let err = ''
      child.stderr.on('data', (d) => (err += d))
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`)),
      )
    })
}
