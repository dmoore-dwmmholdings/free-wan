import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { PlaybackDescriptor } from '@free-wan/shared'

export type VideoPlayerHandle = { play: () => void }
import { api } from '../lib/api'
import { useMediaPrefs } from './MediaPrefsProvider'
import { PlayIcon, PauseIcon, VolumeIcon, VolumeMuteIcon, FullscreenIcon } from './icons'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const s = Math.floor(t % 60)
  const m = Math.floor((t / 60) % 60)
  const h = Math.floor(t / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Player wired to the playback contract: direct-play streams natively; HLS plays via hls.js
 * (or native HLS on Safari). A custom, fully themed control bar (play/pause, scrub, volume,
 * speed, captions, fullscreen) replaces the native chrome to match the Theater design.
 * Handles resume, captions, speed, and throttled progress.
 */
interface VideoPlayerProps {
  id: string
  descriptor: PlaybackDescriptor
  title?: string
  badges?: string[]
  onEnded?: () => void
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ id, descriptor, title, badges = [], onEnded }, handleRef) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLVideoElement>(null)
  useImperativeHandle(handleRef, () => ({ play: () => void ref.current?.play() }), [])
  const trackRef = useRef<HTMLDivElement>(null)
  const lastSent = useRef(0)
  const resumeAt = descriptor.resumeAt ?? 0

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  // Volume + mute live in app-wide prefs so the setting follows you between videos and the gallery.
  const { volume, muted, setVolume, setMuted } = useMediaPrefs()
  const [speed, setSpeed] = useState(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [cc, setCc] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  // Floating thumbnail shown while hovering / dragging the scrub bar. `x` is px from the track's
  // left, `w` its width (for clamping the popover so it can't run off either end).
  const [preview, setPreview] = useState<{ x: number; t: number; w: number } | null>(null)
  const [showResume, setShowResume] = useState(resumeAt > 0)
  const hasCaptions = descriptor.captions.length > 0

  // Idle-hide for the chrome (controls + title) on mouse devices: visible on activity, hidden
  // after 2.5s of playback with no movement. Touch keeps the chrome always visible.
  const [chrome, setChrome] = useState(true)
  const [activity, setActivity] = useState(0)
  const lastPoke = useRef(0)
  const chromeVisible = chrome || !playing || scrubbing || speedOpen
  const poke = (e?: React.PointerEvent) => {
    if (e && e.pointerType && e.pointerType !== 'mouse') return
    const now = Date.now()
    if (chrome && now - lastPoke.current < 500) return // throttle re-renders on mousemove
    lastPoke.current = now
    setChrome(true)
    setActivity((a) => a + 1)
  }
  useEffect(() => {
    if (!playing || scrubbing || speedOpen) return
    const t = setTimeout(() => setChrome(false), 2500)
    return () => clearTimeout(t)
  }, [playing, scrubbing, speedOpen, activity])

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

  useEffect(() => {
    const v = ref.current
    if (v) {
      v.volume = volume
      v.muted = muted
    }
  }, [volume, muted])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i]!.mode = cc && i === 0 ? 'showing' : 'hidden'
  }, [cc])

  const seekFromEvent = (clientX: number) => {
    const el = trackRef.current
    const v = ref.current
    if (!el || !v || !v.duration) return
    const r = el.getBoundingClientRect()
    v.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * v.duration
  }

  // Position the hover thumbnail under the cursor and resolve which time it represents.
  const previewFromEvent = (clientX: number) => {
    const el = trackRef.current
    if (!el || !dur) return setPreview(null)
    const r = el.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    setPreview({ x: frac * r.width, t: frac * dur, w: r.width })
  }

  // Round the requested time to the same ~100 buckets the server caches, so repeat hovers within a
  // bucket hit the browser/disk cache instead of triggering a fresh ffmpeg extract.
  const frameSrc = (t: number) => {
    const stp = dur > 0 ? Math.max(1, dur / 100) : 2
    const q = Math.min(dur || t, Math.max(0, Math.round(t / stp) * stp))
    return `/api/media/${id}/frame?t=${q.toFixed(2)}`
  }

  useEffect(() => {
    if (!scrubbing) return
    const move = (e: PointerEvent) => {
      seekFromEvent(e.clientX)
      previewFromEvent(e.clientX)
    }
    const up = () => {
      setScrubbing(false)
      setPreview(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [scrubbing])

  const togglePlay = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }
  const toggleFullscreen = () => {
    const el = wrapRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null
    const v = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    const doc = document as Document & {
      webkitFullscreenElement?: Element
      webkitExitFullscreen?: () => void
    }
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen()
      else doc.webkitExitFullscreen?.()
      return
    }
    // Prefer fullscreening the wrapper (keeps our custom controls). Fall back through the WebKit
    // prefix, then to the iOS path where only the <video> can go fullscreen — which is also what
    // mobile Safari needs. The .catch covers Androids where requestFullscreen exists but rejects.
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.())
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen()
    else v?.webkitEnterFullscreen?.()
  }

  const pct = dur ? (time / dur) * 100 : 0
  const bufPct = dur ? (buffered / dur) * 100 : 0

  return (
    <div
      ref={wrapRef}
      onPointerMove={poke}
      onPointerDown={poke}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && playing && !scrubbing && !speedOpen) setChrome(false)
      }}
      className={`relative mx-auto aspect-video max-h-[78svh] w-full overflow-hidden rounded-theme bg-black ${chromeVisible ? '' : 'cursor-none'}`}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        className="h-full w-full object-contain"
        onClick={togglePlay}
        onLoadedMetadata={(e) => {
          setDur(e.currentTarget.duration || 0)
          if (resumeAt > 0) e.currentTarget.currentTime = resumeAt
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          post(true)
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          setTime(v.currentTime)
          if (v.currentTime > 8) setShowResume(false)
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
          post()
        }}
        onEnded={() => {
          post(true)
          onEnded?.()
        }}
      >
        {descriptor.captions.map((c) => (
          <track key={c.id} src={c.url} kind="subtitles" label={c.label} srcLang={c.language ?? undefined} default={c.default} />
        ))}
      </video>

      {title && (
        <div className={`pointer-events-none absolute left-5 top-[18px] flex flex-col gap-1.5 transition-opacity duration-300 ${chromeVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="font-head text-2xl font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">{title}</div>
          {badges.length > 0 && (
            <div className="flex gap-1.5">
              {badges.map((b) => (
                <span key={b} className="rounded-md bg-black/40 px-2 py-1 font-mono text-[10px] text-white">{b}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {showResume && (
        <div className="absolute right-5 top-[18px] flex items-center gap-3 rounded-theme-sm border border-line bg-surface px-3.5 py-2.5 shadow-2xl">
          <span className="text-[12.5px] text-ink">
            Resume from <span className="font-mono text-primary">{fmt(resumeAt)}</span>
          </span>
          <button
            onClick={() => {
              if (ref.current) ref.current.currentTime = 0
              setShowResume(false)
            }}
            className="text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
          >
            Start over
          </button>
        </div>
      )}

      {!playing && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute left-1/2 top-1/2 flex h-[78px] w-[78px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
          style={{ background: 'var(--fw-primary)', boxShadow: '0 10px 36px color-mix(in srgb, var(--fw-primary) 55%, transparent)' }}
        >
          <PlayIcon className="ml-1 h-8 w-8 text-on-primary" />
        </button>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-[18px] pb-3.5 pt-10 transition-opacity duration-300 ${
          chromeVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* touch-none stops a scrub drag from also scrolling the page; the py-2 wrapper gives
            the 5px bar a finger-sized hit area on touch screens. */}
        <div
          onPointerDown={(e) => {
            setScrubbing(true)
            seekFromEvent(e.clientX)
            previewFromEvent(e.clientX)
          }}
          onPointerMove={(e) => previewFromEvent(e.clientX)}
          onPointerLeave={() => {
            if (!scrubbing) setPreview(null)
          }}
          className="mb-1 cursor-pointer touch-none py-2"
        >
        <div ref={trackRef} className="relative h-[5px] rounded-full bg-white/20">
          {preview && (
            <div
              className="pointer-events-none absolute bottom-full z-10 mb-2.5 flex flex-col items-center gap-1.5"
              style={{ left: Math.max(80, Math.min(preview.w - 80, preview.x)), transform: 'translateX(-50%)' }}
            >
              <div className="overflow-hidden rounded-theme-sm border border-white/15 bg-black shadow-2xl">
                <img
                  src={frameSrc(preview.t)}
                  alt=""
                  draggable={false}
                  className="block h-[90px] w-40 object-cover"
                  onLoad={(e) => (e.currentTarget.style.visibility = 'visible')}
                  onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                />
              </div>
              <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{fmt(preview.t)}</span>
            </div>
          )}
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufPct}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: 'var(--fw-primary)' }} />
          <div className="absolute top-1/2 h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md" style={{ left: `${pct}%` }} />
        </div>
        </div>
        <div className="flex items-center gap-4 text-white">
          <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="-m-2 p-2">
            {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
          </button>
          <div className="hidden items-center gap-2 sm:flex">
            <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'} className="-m-2 p-2">
              {muted ? <VolumeMuteIcon className="h-[18px] w-[18px]" /> : <VolumeIcon className="h-[18px] w-[18px]" />}
            </button>
            <div
              className="h-1 w-16 cursor-pointer rounded-full bg-white/30"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
              }}
            >
              <div className="h-full rounded-full bg-white" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
            </div>
          </div>
          <span className="font-mono text-xs">
            {fmt(time)} <span className="opacity-60">/ {fmt(dur)}</span>
          </span>
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setSpeedOpen((o) => !o)} className="rounded-md border border-white/30 px-2 py-1 font-mono text-xs">
              {speed}×
            </button>
            {speedOpen && (
              <div className="absolute bottom-full right-0 mb-2 flex flex-col rounded-theme-sm border border-line bg-surface p-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setSpeed(s)
                      setSpeedOpen(false)
                    }}
                    className={`rounded px-3 py-1 text-left font-mono text-xs hover:bg-surface-2 ${s === speed ? 'text-primary' : 'text-ink'}`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            )}
          </div>
          {hasCaptions && (
            <button
              onClick={() => setCc((c) => !c)}
              className={`rounded-md border px-2 py-1 font-mono text-xs font-semibold ${cc ? 'border-accent text-accent' : 'border-white/30 text-white'}`}
            >
              CC
            </button>
          )}
          <button onClick={toggleFullscreen} aria-label="Fullscreen" className="-m-2 p-2">
            <FullscreenIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  )
})
