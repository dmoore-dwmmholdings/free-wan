import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Decides which single video card is "live" (autoplaying its preview) at any moment.
 *
 * As you scroll, "live" follows the feed: the card whose vertical centre sits closest to the middle
 * of the viewport wins. On a hover-capable pointer, moving the mouse over a card also claims the
 * spot (an override) until the next scroll moves on. Only ever one card is live, so at most one
 * preview <video> is mounted and fetching at a time.
 */
type AutoplayMode = 'hover' | 'scroll'

interface AutoplayCtx {
  activeId: string | null
  mode: AutoplayMode
  claim: (id: string) => void
  register: (id: string, el: HTMLElement | null) => void
}

const Ctx = createContext<AutoplayCtx | null>(null)

function detectMode(): AutoplayMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'scroll'
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches ? 'hover' : 'scroll'
}

export function AutoplayProvider({ children }: { children: ReactNode }) {
  const [mode] = useState(detectMode)
  const [activeId, setActiveId] = useState<string | null>(null)
  const registry = useRef(new Map<string, HTMLElement>())
  const raf = useRef(0)

  // Pick the registered card closest to the viewport's vertical centre (scroll mode only).
  const pick = useCallback(() => {
    raf.current = 0
    const vh = window.innerHeight || 0
    const mid = vh / 2
    let best: string | null = null
    let bestDist = Infinity
    for (const [id, el] of registry.current) {
      const r = el.getBoundingClientRect()
      if (r.height === 0 || r.bottom <= 0 || r.top >= vh) continue // fully off-screen
      const dist = Math.abs(r.top + r.height / 2 - mid)
      if (dist < bestDist) {
        bestDist = dist
        best = id
      }
    }
    // Keep the current one playing through gaps (e.g. an all-photos stretch) rather than going dark.
    if (best) setActiveId(best)
  }, [])

  const schedulePick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(pick)
  }, [pick])

  const register = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (el) registry.current.set(id, el)
      else registry.current.delete(id)
      schedulePick()
    },
    [schedulePick],
  )

  const claim = useCallback((id: string) => setActiveId(id), [])

  useEffect(() => {
    const onScroll = () => schedulePick()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    schedulePick()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      // Reset the handle too — leaving it set would make schedulePick() think a frame is still
      // pending after a remount, so it would never schedule pick() again (nothing autoplays).
      if (raf.current) {
        cancelAnimationFrame(raf.current)
        raf.current = 0
      }
    }
  }, [schedulePick])

  const value = useMemo(() => ({ activeId, mode, claim, register }), [activeId, mode, claim, register])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Wire one media card into the autoplay controller. Spread `hoverProps` and attach `setRef` to the
 * card's media box; read `active` to decide whether to mount the preview.
 */
export function useAutoplayCard(id: string) {
  const ctx = useContext(Ctx)
  const claim = ctx?.claim
  const register = ctx?.register
  const setRef = useCallback((el: HTMLElement | null) => register?.(id, el), [register, id])
  const hoverProps = ctx?.mode === 'hover' ? { onMouseEnter: () => claim?.(id) } : {}
  return { active: ctx?.activeId === id, setRef, hoverProps }
}
