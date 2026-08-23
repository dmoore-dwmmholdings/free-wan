import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MediaCard } from '@free-wan/shared'
import { rawUrl } from '../lib/media'
import { useToggleLike } from '../lib/social'
import { useMediaPrefs } from './MediaPrefsProvider'
import { CloseIcon, PlayIcon, PauseIcon, HeartIcon, InfoIcon, ChevronLeftIcon, ChevronRightIcon, VolumeIcon, VolumeMuteIcon } from './icons'

const GLASS = { background: 'color-mix(in srgb, var(--fw-surface) 80%, transparent)' }

/**
 * Full-screen gallery (FR-35–39): keyboard ←/→/Esc/space, tap zones (left=prev,
 * center=toggle chrome, right=next), horizontal swipe to navigate / swipe-down to close,
 * ±1 neighbor preload, slideshow, position indicator, and a filmstrip. Short videos autoplay
 * muted + loop (unless reduced-motion). The sequence is the caller's current result set.
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
  const toggleLike = useToggleLike()
  const { volume, muted, setMuted } = useMediaPrefs()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  // Pinch-zoom (images only, FR-39 polish): transform = translate(tx,ty) scale(scale) on the
  // image. While zoomed, a single pointer pans and swipe/tap-nav are suspended; pinching out
  // to ~1 or double-tapping resets. Zoom clears when the item changes.
  const [zoomT, setZoomT] = useState({ scale: 1, tx: 0, ty: 0 })
  const [gesturing, setGesturing] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number; mid: { x: number; y: number }; tx: number; ty: number } | null>(null)
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const lastTap = useRef<{ t: number; x: number } | null>(null)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const zoomed = zoomT.scale > 1

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
    if (!slideshow || items.length < 2) return
    // Advance immediately (instant feedback that it started) then loop, so it never appears
    // to "do nothing" or get stuck at the last item.
    const advance = () => setIndex((i) => (i + 1) % items.length)
    advance()
    const t = setInterval(advance, 4000)
    return () => clearInterval(t)
  }, [slideshow, items.length])

  // A new item starts unzoomed; pending gesture state can't leak across items.
  useEffect(() => {
    setZoomT({ scale: 1, tx: 0, ty: 0 })
    pinch.current = null
    pan.current = null
    lastTap.current = null
  }, [index])

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

  // Mirror the app-wide audio choice onto the playing video; toggling mute here sticks everywhere.
  useEffect(() => {
    const v = videoRef.current
    if (v) {
      v.muted = muted
      v.volume = volume
    }
  }, [muted, volume, index])

  if (!cur) return null

  // The tap-zone action (thirds: prev / toggle chrome / next). For images it runs on a short
  // delay so a second tap can turn into double-tap zoom instead.
  const singleTapAction = (clientX: number) => {
    const third = (window.innerWidth || 1280) / 3
    if (clientX < third) go(-1)
    else if (clientX > (window.innerWidth || 1280) - third) go(1)
    else setChrome((c) => !c)
  }

  // Double-tap: zoom to 2.5× anchored at the tap point, or back to 1×. With the transform
  // `translate(t) scale(s)` (origin = image centre ≈ viewport centre C), the point under the
  // finger stays put when t_new = P − C − ((P − C − t_old)/s_old)·s_new.
  const toggleZoomAt = (clientX: number, clientY: number) => {
    setZoomT((z) => {
      if (z.scale > 1) return { scale: 1, tx: 0, ty: 0 }
      const target = 2.5
      const cx = (window.innerWidth || 1280) / 2
      const cy = (window.innerHeight || 720) / 2
      const ox = (clientX - cx - z.tx) / z.scale
      const oy = (clientY - cy - z.ty) / z.scale
      return { scale: target, tx: clientX - cx - ox * target, ty: clientY - cy - oy * target }
    })
  }

  const stripStart = Math.max(0, Math.min(Math.max(0, items.length - 13), index - 4))
  const strip = items.slice(stripStart, stripStart + 13)
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onPointerUp: (e: React.PointerEvent) => e.stopPropagation() }
  const circle = 'flex items-center justify-center rounded-full border border-line text-ink backdrop-blur transition hover:text-primary'

  return (
    <div
      className="fixed inset-0 z-50 select-none overflow-hidden bg-bg"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.current.size === 2 && cur.type === 'image') {
          // Second finger down → pinch (images only); any pending tap/swipe is void.
          const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
          pinch.current = {
            dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
            scale: zoomT.scale,
            mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            tx: zoomT.tx,
            ty: zoomT.ty,
          }
          gesture.current = null
          pan.current = null
          setGesturing(true)
        } else if (pointers.current.size === 1) {
          if (zoomed) {
            pan.current = { x: e.clientX, y: e.clientY, tx: zoomT.tx, ty: zoomT.ty }
            setGesturing(true)
          } else {
            gesture.current = { x: e.clientX, y: e.clientY, moved: false }
          }
        }
      }}
      onPointerMove={(e) => {
        if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const p = pinch.current
        if (p && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
          const scale = Math.min(4, Math.max(1, (p.scale * Math.hypot(b.x - a.x, b.y - a.y)) / p.dist))
          const k = scale / p.scale
          setZoomT({ scale, tx: p.mid.x * (1 - k) + p.tx * k, ty: p.mid.y * (1 - k) + p.ty * k })
          return
        }
        if (pan.current) {
          const c = pan.current
          setZoomT((z) => ({ ...z, tx: c.tx + (e.clientX - c.x), ty: c.ty + (e.clientY - c.y) }))
          return
        }
        const g = gesture.current
        if (g && Math.abs(e.clientX - g.x) > 10) g.moved = true
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId)
        pinch.current = null
        pan.current = null
        gesture.current = null
        setGesturing(false)
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId)
        if (pinch.current) {
          if (pointers.current.size < 2) {
            pinch.current = null
            setGesturing(false)
            // Pinched (almost) all the way out → snap clean.
            setZoomT((z) => (z.scale <= 1.05 ? { scale: 1, tx: 0, ty: 0 } : z))
          }
          return
        }
        if (pan.current) {
          const c = pan.current
          pan.current = null
          setGesturing(false)
          // A no-move touch while zoomed is a tap: double-tap zooms back out; a lone tap
          // toggles the chrome (after the double-tap window).
          if (Math.abs(e.clientX - c.x) < 8 && Math.abs(e.clientY - c.y) < 8) {
            if ((e.target as HTMLElement).closest('button, a, input')) return
            const now = Date.now()
            if (lastTap.current && now - lastTap.current.t < 300 && Math.abs(e.clientX - lastTap.current.x) < 40) {
              if (tapTimer.current) clearTimeout(tapTimer.current)
              tapTimer.current = null
              lastTap.current = null
              toggleZoomAt(e.clientX, e.clientY)
              return
            }
            lastTap.current = { t: now, x: e.clientX }
            if (tapTimer.current) clearTimeout(tapTimer.current)
            tapTimer.current = setTimeout(() => {
              tapTimer.current = null
              setChrome((v) => !v)
            }, 280)
          }
          return
        }
        const g = gesture.current
        gesture.current = null
        if (!g) return
        const dx = e.clientX - g.x
        const dy = e.clientY - g.y
        if (g.moved) {
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
          else if (dy > 80) onClose()
        } else {
          // A tap on a control (our chrome buttons/links) must do its own thing — only bare taps on
          // the backdrop / media navigate or toggle chrome. This stops the left/right nav zones from
          // swallowing button taps.
          if ((e.target as HTMLElement).closest('button, a, input')) return
          const now = Date.now()
          if (cur.type === 'image' && lastTap.current && now - lastTap.current.t < 300 && Math.abs(e.clientX - lastTap.current.x) < 40) {
            // Double tap → zoom toggle; the pending single-tap action is cancelled.
            if (tapTimer.current) clearTimeout(tapTimer.current)
            tapTimer.current = null
            lastTap.current = null
            toggleZoomAt(e.clientX, e.clientY)
            return
          }
          lastTap.current = { t: now, x: e.clientX }
          if (cur.type === 'image') {
            // Delay so a second tap can become double-tap zoom (images only).
            const cx = e.clientX
            if (tapTimer.current) clearTimeout(tapTimer.current)
            tapTimer.current = setTimeout(() => {
              tapTimer.current = null
              singleTapAction(cx)
            }, 280)
          } else {
            singleTapAction(e.clientX)
          }
        }
      }}
    >
      <div className="flex h-full w-full items-center justify-center px-6 py-20">
        {cur.type === 'image' ? (
          <img
            src={rawUrl(cur.id, displayW)}
            alt={cur.title}
            draggable={false}
            className="max-h-full max-w-full rounded-theme object-contain shadow-2xl"
            style={{
              transform: `translate(${zoomT.tx}px, ${zoomT.ty}px) scale(${zoomT.scale})`,
              transition: gesturing ? 'none' : 'transform 180ms ease-out',
              willChange: 'transform',
            }}
          />
        ) : (
          <video
            key={cur.id}
            // Apply mute/volume as *properties* (React's `muted` attribute is unreliable) from the
            // shared prefs, so audio matches the rest of the app.
            ref={(el) => {
              videoRef.current = el
              if (el) {
                el.muted = muted
                el.volume = volume
              }
            }}
            src={`/api/media/${cur.id}/stream`}
            className="max-h-full max-w-full rounded-theme object-contain shadow-2xl"
            loop
            autoPlay
            playsInline
            // No native control bar: in this quick-browse gallery it re-appeared on every video and
            // covered the frame. Videos autoplay muted + loop; the gallery's own chrome handles nav,
            // and the mute toggle lives in the top bar.
            // A video the user explicitly opened should play regardless of the OS reduced-motion
            // setting. If unmuted autoplay is blocked, fall back to muted so it still plays.
            onLoadedData={(e) => {
              const v = e.currentTarget
              v.muted = muted
              v.volume = volume
              void v.play().catch(() => {
                v.muted = true
                void v.play().catch(() => {})
              })
            }}
          />
        )}
      </div>

      {chrome && (
        <>
          {/* top chrome */}
          <div
            className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-bg/90 to-transparent px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3.5"
            {...stop}
          >
            <button onClick={onClose} aria-label="Close" style={GLASS} className={`${circle} h-8 w-8 flex-none`}>
              <CloseIcon className="h-4 w-4" />
            </button>
            {/* Title grows (and truncates) on mobile to push the counter+actions to the edge; on
                desktop it sizes to content and the flex-1 spacers centre the counter instead. */}
            <div className="flex min-w-0 flex-1 flex-col sm:flex-none">
              <div className="truncate text-sm font-semibold text-ink">{cur.title}</div>
              {cur.categoryPath && <div className="truncate font-mono text-[10.5px] text-muted">{cur.categoryPath.replace(/[\\/]+/g, ' · ')}</div>}
            </div>
            <div className="hidden flex-1 sm:block" />
            <div style={GLASS} className="flex-none rounded-full border border-line px-2.5 py-1 font-mono text-[12px] text-ink backdrop-blur sm:px-3.5 sm:py-1.5 sm:text-[13px]">
              {index + 1} <span className="text-muted">/ {items.length}</span>
            </div>
            <div className="hidden flex-1 sm:block" />
            <div className="flex flex-none items-center gap-1.5 sm:gap-2.5">
              {cur.type === 'video' && (
                <button
                  onClick={() => setMuted(!muted)}
                  aria-pressed={!muted}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  style={GLASS}
                  className={`${circle} h-[34px] w-[34px] ${muted ? '' : 'text-primary'}`}
                >
                  {muted ? <VolumeMuteIcon className="h-4 w-4" /> : <VolumeIcon className="h-4 w-4" />}
                </button>
              )}
              <button
                onClick={() => toggleLike.mutate({ id: cur.id, liked: cur.liked })}
                aria-pressed={cur.liked}
                aria-label={cur.liked ? 'Unlike' : 'Like'}
                style={GLASS}
                className={`${circle} h-[34px] w-[34px] ${cur.liked ? 'text-accent' : ''}`}
              >
                <HeartIcon filled={cur.liked} className="h-4 w-4" />
              </button>
              <Link to={`/media/${cur.id}`} aria-label="Details" style={GLASS} className={`${circle} h-[34px] w-[34px]`}>
                <InfoIcon className="h-4 w-4" />
              </Link>
              <button
                onClick={() => setSlideshow((s) => !s)}
                aria-label={slideshow ? 'Pause slideshow' : 'Start slideshow'}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-on-primary"
                style={{ background: 'var(--fw-primary)' }}
              >
                {slideshow ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="ml-0.5 h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* side arrows */}
          <button onClick={() => go(-1)} aria-label="Previous" style={GLASS} className={`${circle} absolute left-6 top-1/2 z-10 h-[46px] w-[46px] -translate-y-1/2`} {...stop}>
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button onClick={() => go(1)} aria-label="Next" style={GLASS} className={`${circle} absolute right-6 top-1/2 z-10 h-[46px] w-[46px] -translate-y-1/2`} {...stop}>
            <ChevronRightIcon className="h-5 w-5" />
          </button>

          {/* filmstrip — desktop only; on phones it overflowed, and swipe/tap/arrows cover nav */}
          <div className="absolute inset-x-0 bottom-0 z-10 hidden items-center justify-center gap-2.5 bg-gradient-to-t from-bg/90 to-transparent px-6 py-4 sm:flex" {...stop}>
            {strip.map((s, j) => {
              const actual = stripStart + j
              const active = actual === index
              return (
                <button
                  key={s.id}
                  onClick={() => setIndex(actual)}
                  className={`h-[68px] w-[78px] flex-none overflow-hidden rounded-lg transition ${active ? 'opacity-100 ring-2 ring-primary' : 'opacity-60 hover:opacity-90'}`}
                >
                  <img src={s.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
