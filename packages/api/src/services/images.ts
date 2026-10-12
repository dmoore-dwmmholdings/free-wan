import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

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

/** Converts a HEIC photo to a JPEG at outPath. Injected so the routes and jobs are testable. */
export type HeifConverter = (input: { absPath: string; outPath: string }) => Promise<void>

/** ffmpeg cannot read HEIC, the iPhone's photo format, so those photos go through libheif. */
export function createHeifConverter(heifConvertPath = 'heif-convert'): HeifConverter {
  return ({ absPath, outPath }) =>
    new Promise<void>((resolve, reject) => {
      // heif-convert picks the format from the extension; a unique temp name lets a request and
      // the thumbnail job convert the same photo at once.
      const tmpPath = `${outPath}.${process.pid}-${Math.random().toString(36).slice(2)}.part.jpg`
      const child = spawn(heifConvertPath, ['-q', '90', absPath, tmpPath], { shell: false })
      let err = ''
      child.stderr.on('data', (d) => (err += d))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`heif-convert exited ${code}: ${err.trim()}`))
        try {
          renameSync(tmpPath, outPath)
          resolve()
        } catch (e) {
          reject(e as Error)
        }
      })
    })
}

export const isHeif = (ext: string): boolean => ext === 'heic' || ext === 'heif'

/** A path ffmpeg can read for this image: the file itself, or for HEIC a JPEG copy made once in outDir. */
export async function readableImage(absPath: string, ext: string, outDir: string, convert: HeifConverter): Promise<string> {
  if (!isHeif(ext)) return absPath
  const outPath = join(outDir, 'source.jpg')
  if (!existsSync(outPath)) {
    mkdirSync(outDir, { recursive: true })
    await convert({ absPath, outPath })
  }
  return outPath
}
