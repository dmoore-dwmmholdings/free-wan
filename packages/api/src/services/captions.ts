import { spawn } from 'node:child_process'

export interface CaptionSource {
  /** Absolute path to the media file (embedded) or the sidecar subtitle file. */
  absPath: string
  /** Embedded subtitle stream index (0-based among subtitle streams), if embedded. */
  streamIndex?: number
}

/** Converts a subtitle source to WebVTT text. Injected so the route is testable. */
export type CaptionConverter = (src: CaptionSource) => Promise<string>

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`)),
    )
  })
}

/** Real ffmpeg-backed converter (media pipeline §6). Emits WebVTT to stdout. */
export function createCaptionConverter(ffmpegPath = 'ffmpeg'): CaptionConverter {
  return ({ absPath, streamIndex }) => {
    const args = ['-nostdin', '-v', 'error', '-i', absPath]
    if (streamIndex !== undefined) args.push('-map', `0:s:${streamIndex}`)
    args.push('-f', 'webvtt', '-')
    return run(ffmpegPath, args)
  }
}
