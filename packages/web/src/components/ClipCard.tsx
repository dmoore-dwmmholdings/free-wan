import { useEffect, useRef, useState } from 'react'
import type { ClipDto } from '@free-wan/shared'
import { useDeleteClip, useExportClip } from '../lib/clips'

/** A clip preview that virtual-loops its source range, playing only while visible. */
export function ClipCard({ clip }: { clip: ClipDto }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)
  const del = useDeleteClip()
  const exp = useExportClip()

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
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <div className="relative aspect-video bg-neutral-800">
        {clip.orphaned ? (
          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-neutral-500">
            Source unavailable
          </div>
        ) : (
          <video
            ref={ref}
            src={`/api/media/${clip.sourceItemId}/stream`}
            poster={clip.posterUrl ?? undefined}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = clip.startS
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget
              if (v.currentTime >= clip.endS || v.currentTime < clip.startS - 0.1) v.currentTime = clip.startS
            }}
          />
        )}
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
          {clip.durationS.toFixed(1)}s
        </span>
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate text-sm text-neutral-100" title={clip.name}>
          {clip.name}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          {clip.exportUrl ? (
            <a href={clip.exportUrl} className="text-green-400 hover:underline">
              Download
            </a>
          ) : clip.exportStatus === 'queued' || clip.exportStatus === 'rendering' ? (
            <span className="text-neutral-500">Exporting…</span>
          ) : (
            !clip.orphaned && (
              <button onClick={() => exp.mutate({ id: clip.id, format: 'mp4' })} className="text-neutral-400 hover:text-brand">
                Export MP4
              </button>
            )
          )}
          <button onClick={() => del.mutate(clip.id)} className="ml-auto text-neutral-500 hover:text-red-400">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
