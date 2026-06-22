import { spawn } from 'node:child_process'

export interface ClipExportInput {
  absPath: string
  startS: number
  endS: number
  format: 'mp4' | 'gif'
  outPath: string
}

/** Renders a clip range to a file. Injected so the export job is testable. */
export type ClipExporter = (input: ClipExportInput) => Promise<void>

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

/** Real ffmpeg-backed clip exporter (media pipeline §10). No shell. */
export function createClipExporter(ffmpegPath = 'ffmpeg'): ClipExporter {
  return async ({ absPath, startS, endS, format, outPath }) => {
    const dur = (endS - startS).toFixed(3)
    if (format === 'mp4') {
      await run(ffmpegPath, [
        '-nostdin', '-v', 'error', '-y',
        '-ss', startS.toFixed(3), '-t', dur, '-i', absPath,
        '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast',
        '-c:a', 'aac', '-movflags', '+faststart',
        outPath,
      ])
      return
    }
    // GIF via palette for quality.
    const palette = `${outPath}.palette.png`
    await run(ffmpegPath, [
      '-nostdin', '-v', 'error', '-y',
      '-ss', startS.toFixed(3), '-t', dur, '-i', absPath,
      '-vf', 'fps=15,scale=480:-1:flags=lanczos,palettegen',
      palette,
    ])
    await run(ffmpegPath, [
      '-nostdin', '-v', 'error', '-y',
      '-ss', startS.toFixed(3), '-t', dur, '-i', absPath,
      '-i', palette,
      '-lavfi', 'fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse',
      outPath,
    ])
  }
}
