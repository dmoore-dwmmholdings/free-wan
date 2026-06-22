import { spawn } from 'node:child_process'

export interface EmbeddedSub {
  streamIndex: number
  language?: string
  format?: string
}

export interface ProbeResult {
  durationS?: number
  width?: number
  height?: number
  frameRate?: number
  bitrate?: number
  container?: string
  videoCodec?: string
  audioCodec?: string
  audioTracks: number
  embeddedSubs: EmbeddedSub[]
  capturedAt?: number
}

/** A function that probes an absolute path. Injected so the scanner is testable. */
export type Prober = (absPath: string) => Promise<ProbeResult>

function parseRate(r?: string): number | undefined {
  if (!r) return undefined
  const [n, d] = r.split('/').map(Number)
  if (!n || !d) return undefined
  return n / d
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Pure mapping from ffprobe JSON → ProbeResult (media pipeline §3). Unit-testable. */
export function mapProbe(json: unknown): ProbeResult {
  const j = (json ?? {}) as {
    format?: { duration?: string; bit_rate?: string; format_name?: string; tags?: Record<string, string> }
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      bit_rate?: string
      index?: number
      duration?: string
      tags?: Record<string, string>
    }>
  }
  const streams = Array.isArray(j.streams) ? j.streams : []
  const format = j.format ?? {}
  const video = streams.find((s) => s.codec_type === 'video')
  const audios = streams.filter((s) => s.codec_type === 'audio')
  const subs = streams.filter((s) => s.codec_type === 'subtitle')

  const created = format.tags?.creation_time ? Date.parse(format.tags.creation_time) : NaN

  return {
    durationS: num(format.duration) ?? num(video?.duration),
    width: video?.width,
    height: video?.height,
    frameRate: parseRate(video?.avg_frame_rate),
    bitrate: num(format.bit_rate) ?? num(video?.bit_rate),
    container: format.format_name,
    videoCodec: video?.codec_name,
    audioCodec: audios[0]?.codec_name,
    audioTracks: audios.length,
    embeddedSubs: subs.map((s) => ({
      streamIndex: s.index ?? 0,
      language: s.tags?.language,
      format: s.codec_name,
    })),
    capturedAt: Number.isFinite(created) ? created : undefined,
  }
}

/** Real ffprobe-backed prober. No shell: argv array via spawn (security §5). */
export function createFfprobe(ffprobePath = 'ffprobe'): Prober {
  return (absPath) =>
    new Promise<ProbeResult>((resolve, reject) => {
      const args = [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        absPath,
      ]
      const child = spawn(ffprobePath, args, { shell: false })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.trim()}`))
        try {
          resolve(mapProbe(JSON.parse(out)))
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    })
}
