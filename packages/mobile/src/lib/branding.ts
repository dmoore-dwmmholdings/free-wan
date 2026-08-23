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

/** How long the app will wait for branding before showing itself anyway. */
const BRANDING_WAIT_MS = 2000

/**
 * Apply the server's branding to the app's tokens, and report when that has settled.
 *
 * Not a TanStack query: it runs above the QueryClientProvider so the whole tree, login screen
 * included, is branded on first paint. `/api/branding` is public for the same reason on web.
 *
 * The caller holds the app back until this returns true, so the tree mounts once with the
 * right colours. An earlier version rendered immediately and forced the new tokens in by
 * keying the root on a version number — which remounted everything, and remounting resets
 * navigation: a link straight to an item opened the library instead, because the deep link
 * was discarded a moment after it arrived. Waiting costs a moment on a screen that is a
 * single colour anyway.
 *
 * The wait is capped. `fetch` has no timeout of its own here, so a server that accepts the
 * connection and then says nothing would otherwise hold the app on a blank screen for as long
 * as the platform allows — a minute on iOS. Past the cap the built-in palette is used;
 * branding that turns up later is still applied, and is picked up by whatever renders next.
 */
export function useBranding(): boolean {
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Before branding answers — and on the login screen, which is reached before there is a
    // server to ask — this settles the chrome on the built-in palette rather than the phone's.
    syncColorScheme()

    const release = () => {
      if (!cancelled) setSettled(true)
    }
    const cap = setTimeout(release, BRANDING_WAIT_MS)

    void (async () => {
      try {
        // Before a server is chosen there is nothing to ask, and the defaults are already right.
        const server = await getServerUrl()
        if (!server) return
        const branding = await api.get<Branding>('/api/branding')
        if (cancelled) return
        applyBranding(branding)
        syncColorScheme()
      } catch {
        // An unreachable or older server leaves the built-in palette in place. Branding is
        // decoration; failing to fetch it must not keep anyone out of their library.
      } finally {
        clearTimeout(cap)
        release()
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(cap)
    }
  }, [])

  return settled
}
