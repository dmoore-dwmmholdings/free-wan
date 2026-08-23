import { useEffect, useState } from 'react'
import { Appearance } from 'react-native'
import type { Branding } from '@free-wan/shared'
import { api } from './api'
import { applyBranding, theme } from '@/theme'
import { isLight } from './palette'
import { getServerUrl } from './session'

/**
 * Point the platform's own chrome at the brand rather than at the device.
 *
 * The keyboard, system dialogs, action sheets and text-selection handles take their look from
 * the app's colour scheme, not from our tokens. Left alone they follow the phone, so a light
 * preset could hand you a dark keyboard and a dark alert over a cream screen — the same
 * half-applied look that following branding was meant to remove. `app.json` declares
 * `userInterfaceStyle: "automatic"` so this call is what decides it.
 */
function syncColorScheme(): void {
  // Guarded because this is not implemented everywhere. React Native types it as always
  // present, but react-native-web has no such function and the platform docs put it at
  // iOS 13+ / Android 10+. Calling it blind throws during the first render of the root, which
  // takes the whole app down to a blank screen — no error state, because the thing that would
  // draw one never mounts. Chrome is decoration; it is not worth the app.
  if (typeof Appearance.setColorScheme !== 'function') return
  Appearance.setColorScheme(isLight(theme.color.bg) ? 'light' : 'dark')
}

/**
 * Apply the server's branding to the app's tokens.
 *
 * Not a TanStack query: it runs above the QueryClientProvider so the whole tree, login screen
 * included, is already branded on first paint rather than repainting a moment later.
 * `/api/branding` is public for the same reason on the web.
 *
 * Returns a version number that changes once branding has been applied. The root renders with
 * it as a key, which is what makes the mutated tokens in `theme` take effect — see the note
 * there about why the tokens are a mutable singleton.
 */
export function useBranding(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Before branding answers — and on the login screen, which is reached before there is a
    // server to ask — this settles the chrome on the built-in palette rather than the phone's.
    syncColorScheme()

    void (async () => {
      // Before a server is chosen there is nothing to ask, and the defaults are already right.
      if (!(await getServerUrl())) return
      try {
        const branding = await api.get<Branding>('/api/branding')
        if (cancelled) return
        applyBranding(branding)
        syncColorScheme()
        setVersion((v) => v + 1)
      } catch {
        // An unreachable or older server leaves the built-in palette in place. Branding is
        // decoration; failing to fetch it must not keep anyone out of their library.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return version
}
