import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ClipDto } from '@free-wan/shared'
import { useDeleteClip, useExportClip } from '../lib/clips'

/** A clip preview that virtual-loops its source range, playing only while visible. */
export function ClipCard({ clip }: { clip: ClipDto }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const del = useDeleteClip()
  const exp = useExportClip()

  // Fullscreen playback: click the preview to play fullscreen with sound. Fullscreen the <video>
  // element itself (not the wrapper) — a natively-fullscreened video is letterboxed to show the
  // WHOLE frame, whereas the card deliberately crops it to fill (object-cover). The virtual-loop
  // logic runs off the video's own timeupdate, so it keeps working in fullscreen either way.
  const openFullscreen = () => {
    const v = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!v) return
    v.muted = false
    void v.play().catch(() => {})
    if (v.requestFullscreen) void v.requestFullscreen().catch(() => v.webkitEnterFullscreen?.())
    else v.webkitEnterFullscreen?.() // Safari/iOS
  }
  useEffect(() => {
    const onChange = () => {
      const isFs = document.fullscreenElement === ref.current
      setFullscreen(isFs)
      if (ref.current && !isFs) ref.current.muted = true // re-mute on exit
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (visible) void v.play().catch(() => {})
    else v.pause()
  }, [visible])

  return (
    <div className="flex flex-col gap-2.5">
      <div
        onClick={clip.orphaned ? undefined : openFullscreen}
        role={clip.orphaned ? undefined : 'button'}
        aria-label={clip.orphaned ? undefined : `Play ${clip.name} fullscreen`}
        className={`relative aspect-video overflow-hidden rounded-theme-sm bg-surface-2 ${clip.orphaned ? '' : 'cursor-pointer'}`}
      >
        {clip.orphaned ? (
          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">Source unavailable</div>
        ) : (
          <video
            ref={ref}
            src={`/api/media/${clip.sourceItemId}/stream`}
            poster={clip.posterUrl ?? undefined}
            muted
            playsInline
            preload="metadata"
            className={`h-full w-full ${fullscreen ? 'object-contain' : 'object-cover'}`}
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = clip.startS
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget
              if (v.currentTime >= clip.endS || v.currentTime < clip.startS - 0.1) v.currentTime = clip.startS
            }}
          />
        )}
        <span className="absolute bottom-[7px] right-[7px] rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9.5px] text-white backdrop-blur-sm">
          {clip.durationS.toFixed(1)}s
        </span>
      </div>
      <div className="flex flex-col gap-1 px-px">
        <div className="truncate text-[13px] font-semibold text-ink" title={clip.name}>
          {clip.name}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {!clip.orphaned && clip.sourceItemId && (
            <Link to={`/watch/${clip.sourceItemId}`} className="text-muted hover:text-primary">
              Source
            </Link>
          )}
          {clip.exportUrl ? (
            <a href={clip.exportUrl} className="text-accent hover:underline">
              Download
            </a>
          ) : clip.exportStatus === 'queued' || clip.exportStatus === 'rendering' ? (
            <span className="text-muted">Exporting…</span>
          ) : (
            !clip.orphaned && (
              <button onClick={() => exp.mutate({ id: clip.id, format: 'mp4' })} className="text-muted hover:text-primary">
                Export MP4
              </button>
            )
          )}
          <button onClick={() => del.mutate(clip.id)} className="ml-auto text-muted hover:text-red-400">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
