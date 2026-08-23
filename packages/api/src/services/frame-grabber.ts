import { spawn } from 'node:child_process'
import { renameSync } from 'node:fs'

/** Extracts a single JPEG frame from a video at a timestamp. Injected so the route is testable. */
export type FrameGrabber = (input: {
  absPath: string
  timeS: number
  width: number
  outPath: string
}) => Promise<void>

/**
 * Real ffmpeg-backed frame grabber for scrubbing previews. `-ss` *before* `-i` does a fast input
 * seek to the nearest keyframe — approximate but near-instant, which is what a scrub thumbnail
 * wants. No shell.
 */
export function createFrameGrabber(ffmpegPath = 'ffmpeg'): FrameGrabber {
  return ({ absPath, timeS, width, outPath }) =>
    new Promise<void>((resolve, reject) => {
      // Write to a temp name, rename on success: outPath never exists half-written
      // (a crash mid-write must not leave a truncated JPEG that gets served forever).
      const tmpPath = `${outPath}.part.jpg`
      const args = [
        '-nostdin', '-v', 'error', '-y',
        '-ss', Math.max(0, timeS).toFixed(3),
        '-i', absPath,
        '-frames:v', '1',
        '-vf', `scale=${width}:-2`,
        '-q:v', '5',
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
