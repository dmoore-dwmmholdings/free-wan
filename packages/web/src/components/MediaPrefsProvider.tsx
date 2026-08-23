import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * App-wide playback preferences (volume + mute), shared across every player so the choice
 * follows you around: unmute a clip in the gallery and the next video you open is unmuted too.
 * Persisted to localStorage so it also survives reloads. Default is muted so inline/gallery
 * autoplay is always permitted; the user unmutes once and it sticks everywhere.
 */
interface MediaPrefs {
  volume: number
  muted: boolean
  setVolume: (v: number) => void
  setMuted: (m: boolean) => void
}

const MediaPrefsContext = createContext<MediaPrefs | null>(null)
const KEY = 'fw-media-prefs'

function load(): { volume: number; muted: boolean } {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as { volume?: unknown; muted?: unknown }
      return {
        volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 1,
        muted: typeof p.muted === 'boolean' ? p.muted : true,
      }
    }
  } catch {
    /* ignore malformed/blocked storage */
  }
  return { volume: 1, muted: true }
}

export function MediaPrefsProvider({ children }: { children: ReactNode }) {
  const [{ volume, muted }, set] = useState(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ volume, muted }))
    } catch {
      /* ignore storage failures (private mode, quota) */
    }
  }, [volume, muted])

  const value = useMemo<MediaPrefs>(
    () => ({
      volume,
      muted,
      // Nudging the slider above zero implies you want to hear it.
      setVolume: (v) => set((s) => ({ volume: Math.min(1, Math.max(0, v)), muted: v <= 0 ? s.muted : false })),
      setMuted: (m) => set((s) => ({ ...s, muted: m })),
    }),
    [volume, muted],
  )

  return <MediaPrefsContext.Provider value={value}>{children}</MediaPrefsContext.Provider>
}

export function useMediaPrefs(): MediaPrefs {
  const ctx = useContext(MediaPrefsContext)
  if (!ctx) throw new Error('useMediaPrefs must be used within MediaPrefsProvider')
  return ctx
}
