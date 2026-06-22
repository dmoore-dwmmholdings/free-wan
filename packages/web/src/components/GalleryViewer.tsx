import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MediaCard } from '@free-wan/shared'
import { rawUrl } from '../lib/media'
import { CloseIcon, PlayIcon, PauseIcon } from './icons'

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(m.matches)
    const handler = () => setReduced(m.matches)
    m.addEventListener?.('change', handler)
    return () => m.removeEventListener?.('change', handler)
  }, [])
  return reduced
}

/**
 * Full-screen gallery (FR-35–39): keyboard ←/→/Esc/space, tap zones (left=prev,
 * center=toggle chrome, right=next), horizontal swipe to navigate / swipe-down to close,
 * ±1 neighbor preload, slideshow, and a position indicator. Short videos autoplay muted +
 * loop (unless reduced-motion). The sequence is the caller's current result set.
 */
export function GalleryViewer({
  items,
  startIndex,
  onClose,
}: {
  items: MediaCard[]
  startIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const [chrome, setChrome] = useState(true)
  const [slideshow, setSlideshow] = useState(false)
  const reduced = usePrefersReducedMotion()
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const clamp = (i: number) => Math.max(0, Math.min(items.length - 1, i))
  const go = (d: number) => setIndex((i) => clamp(i + d))
  const cur = items[index]
  const displayW = Math.min(2560, Math.round((window.innerWidth || 1280) * (window.devicePixelRatio || 1)))

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'Escape') onClose()
      else if (e.key === ' ') {
        e.preventDefault()
        setSlideshow((s) => !s)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length])

  useEffect(() => {
    if (!slideshow) return
    const t = setInterval(() => setIndex((i) => (i < items.length - 1 ? i + 1 : i)), 5000)
    return () => clearInterval(t)
  }, [slideshow, items.length])

  // Preload neighbors so left/right feels instant.
  useEffect(() => {
    for (const j of [index - 1, index + 1]) {
      const it = items[j]
      if (it?.type === 'image') {
        const img = new Image()
        img.src = rawUrl(it.id, displayW)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  if (!cur) return null

  return (
    <div
      className="fixed inset-0 z-50 select-none bg-black"
      onPointerDown={(e) => {
        gesture.current = { x: e.clientX, y: e.clientY, moved: false }
      }}
      onPointerMove={(e) => {
        const g = gesture.current
        if (g && Math.abs(e.clientX - g.x) > 10) g.moved = true
      }}
      onPointerUp={(e) => {
        const g = gesture.current
        gesture.current = null
        if (!g) return
        const dx = e.clientX - g.x
        const dy = e.clientY - g.y
        if (g.moved) {
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
          else if (dy > 80) onClose()
        } else {
          const third = (window.innerWidth || 1280) / 3
          if (e.clientX < third) go(-1)
          else if (e.clientX > (window.innerWidth || 1280) - third) go(1)
          else setChrome((c) => !c)
        }
      }}
    >
      <div className="flex h-full w-full items-center justify-center">
        {cur.type === 'image' ? (
          <img src={rawUrl(cur.id, displayW)} alt={cur.title} className="max-h-full max-w-full object-contain" />
        ) : (
          <video
            key={cur.id}
            src={`/api/media/${cur.id}/stream`}
            className="max-h-full max-w-full object-contain"
            muted
            loop
            autoPlay={!reduced}
            playsInline
            controls={chrome}
          />
        )}
      </div>

      {chrome && (
        <div
          className="absolute left-0 right-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent p-4 text-white"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <span className="rounded bg-black/50 px-2 py-1 text-sm tabular-nums">
            {index + 1} / {items.length}
          </span>
          <span className="min-w-0 flex-1 truncate text-center text-sm text-neutral-300">{cur.title}</span>
          <div className="flex items-center gap-2">
            <Link
              to={`/media/${cur.id}`}
              onPointerDown={(e) => e.stopPropagation()}
              className="rounded bg-black/50 px-2 py-1 text-sm hover:text-brand"
            >
              Details
            </Link>
            <button
              onClick={() => setSlideshow((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded bg-black/50 px-2 py-1 text-sm"
            >
              {slideshow ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
              {slideshow ? 'Pause' : 'Slideshow'}
            </button>
            <button onClick={onClose} aria-label="Close" className="rounded bg-black/50 p-1.5 text-sm">
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
