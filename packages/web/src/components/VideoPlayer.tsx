import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { PlaybackDescriptor } from '@free-wan/shared'
import { api } from '../lib/api'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

/**
 * Player wired to the playback contract: direct-play streams natively; HLS plays via
 * hls.js (or native HLS on Safari). Handles resume, captions, speed, and throttled
 * progress. Isolated so it can be swapped for the Vidstack player later.
 */
export function VideoPlayer({ id, descriptor }: { id: string; descriptor: PlaybackDescriptor }) {
  const ref = useRef<HTMLVideoElement>(null)
  const lastSent = useRef(0)
  const [speed, setSpeed] = useState(1)

  const post = (final = false) => {
    const v = ref.current
    if (!v || !v.duration || Number.isNaN(v.duration)) return
    const now = Date.now()
    if (!final && now - lastSent.current < 9500) return
    lastSent.current = now
    void api.post(`/api/media/${id}/progress`, { positionS: v.currentTime, durationS: v.duration }).catch(() => {})
  }

  // Attach the source (direct vs HLS) and clean up hls.js on change/unmount.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (descriptor.mode === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true })
      hls.loadSource(descriptor.url)
      hls.attachMedia(v)
      return () => hls.destroy()
    }
    v.src = descriptor.url
    return undefined
  }, [descriptor.url, descriptor.mode])

  useEffect(() => {
    post(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- final flush on unmount

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed
  }, [speed])

  return (
    <div>
      <video
        ref={ref}
        controls
        autoPlay
        playsInline
        className="max-h-[80vh] w-full rounded-xl bg-black"
        onLoadedMetadata={(e) => {
          if (descriptor.resumeAt && descriptor.resumeAt > 0) e.currentTarget.currentTime = descriptor.resumeAt
        }}
        onTimeUpdate={() => post()}
        onPause={() => post(true)}
        onEnded={() => post(true)}
      >
        {descriptor.captions.map((c) => (
          <track
            key={c.id}
            src={c.url}
            kind="subtitles"
            label={c.label}
            srcLang={c.language ?? undefined}
            default={c.default}
          />
        ))}
      </video>
      <div className="mt-2 flex items-center gap-2 text-sm text-neutral-400">
        <span>Speed</span>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
