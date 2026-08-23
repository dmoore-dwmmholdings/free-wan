// E2E server wrapper. Playwright launches the webServer BEFORE globalSetup runs, so the
// per-run state reset has to happen here, in the server process itself, before the app boots:
// wipe the data dir (fresh bootstrap admin + forced password change every run) and generate
// the media fixture, then start the real built API.
import { rm, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const run = promisify(execFile)

await rm(join(here, '.data'), { recursive: true, force: true })

const photos = join(here, '.media', 'Photos')
const videos = join(here, '.media', 'Videos')
const jpeg = join(photos, 'red.jpg')
const mp4 = join(videos, 'ocean.mp4')
try {
  // ffmpeg is already a hard runtime dependency of the app.
  if (!existsSync(jpeg)) {
    await mkdir(photos, { recursive: true })
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240', '-frames:v', '1', jpeg])
  }
  if (!existsSync(mp4)) {
    await mkdir(videos, { recursive: true })
    // 3 s h264/yuv420p test pattern — browser-native, so the player direct-plays it.
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '3', '-pix_fmt', 'yuv420p', mp4])
  }
  // A big flat library for the virtualized-grid / infinite-scroll flow (copies of the JPEG).
  const bulk = join(here, '.media', 'Bulk')
  if (!existsSync(join(bulk, 'bulk_120.jpg'))) {
    await mkdir(bulk, { recursive: true })
    for (let i = 1; i <= 120; i++) {
      await copyFile(jpeg, join(bulk, `bulk_${String(i).padStart(3, '0')}.jpg`))
    }
  }
} catch (e) {
  throw new Error(`ffmpeg is required to generate the e2e media fixtures: ${e.message}`)
}

await import('../packages/api/dist/index.js')
