// Direct-play vs. HLS decisioning (media pipeline §7). Pure; cached on media_items.playback_mode.

const DIRECT_CONTAINERS = new Set(['mp4', 'm4v', 'webm', 'mov'])
const DIRECT_VIDEO = new Set(['h264', 'vp9', 'av1', 'hevc'])
const DIRECT_AUDIO = new Set(['aac', 'opus', 'mp3'])

export interface PlaybackInputs {
  /** File extension — the reliable container signal. ffprobe's `format_name` is ambiguous
   *  (e.g. an `.mkv` reports `matroska,webm`), so we key the container check on the ext. */
  ext?: string | null
  videoCodec?: string | null
  audioCodec?: string | null
}

export function decidePlaybackMode(p: PlaybackInputs): 'direct' | 'hls' {
  const okContainer = !!p.ext && DIRECT_CONTAINERS.has(p.ext.toLowerCase())
  const okVideo = !!p.videoCodec && DIRECT_VIDEO.has(p.videoCodec.toLowerCase())
  const okAudio = !p.audioCodec || DIRECT_AUDIO.has(p.audioCodec.toLowerCase())
  return okContainer && okVideo && okAudio ? 'direct' : 'hls'
}
