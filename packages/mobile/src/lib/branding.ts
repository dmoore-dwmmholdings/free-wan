import { useEffect, useState } from 'react'
import { Appearance } from 'react-native'
import type { Branding } from '@free-wan/shared'
import { api } from './api'
import { applyBranding, theme } from '@/theme'
import { isLight } from './palette'
import { getServerUrl, subscribeSession } from './session'

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
 * Fetch the server's branding into the app's tokens, now and whenever the session changes.
 *
 * Split out from the hook below so it can be tested: this is the third defect to come out of
 * this file, and every one of them was in the sequencing rather than in any single line.
 *
 * `onSettled` fires once, when the app should stop waiting — branding applied, failed, or the
 * cap reached. `onApplied` fires each time the tokens actually change, so the caller can render
 * again. Returns a teardown.
 */
export function startBranding(onSettled: () => void, onApplied: () => void): () => void {
  let cancelled = false
  // The server whose branding is already loaded. Not a boolean: moving to a different server
  // has to fetch again.
  let fetchedFor: string | null = null

  // Before branding answers — and on the login screen, which is reached before there is a
  // server to ask — this settles the chrome on the built-in palette rather than the phone's.
  syncColorScheme()

  const release = () => {
    if (!cancelled) onSettled()
  }
  const cap = setTimeout(release, BRANDING_WAIT_MS)

  const load = async (atStartup: boolean) => {
    try {
      const server = await getServerUrl()
      // A first launch has no server at all, so this is not something to do once and forget:
      // signing in is when a server first exists, and it is the moment the app should start
      // wearing that server's name and colours rather than the built-in ones.
      if (!server || server === fetchedFor) return
      fetchedFor = server
      try {
        const branding = await api.get<Branding>('/api/branding')
        if (cancelled) return
        applyBranding(branding)
        syncColorScheme()
        onApplied()
      } catch {
        // Let a later sign-in try again rather than leaving this server marked as done.
        fetchedFor = null
        throw new Error('branding unavailable')
      }
    } catch {
      // An unreachable or older server leaves the built-in palette in place. Branding is
      // decoration; failing to fetch it must not keep anyone out of their library.
    } finally {
      if (atStartup) {
        clearTimeout(cap)
        release()
      }
    }
  }

  void load(true)
  // Signing in, signing out, or moving to a different server all come through here.
  const unsubscribe = subscribeSession(() => {
    void load(false)
  })

  return () => {
    cancelled = true
    clearTimeout(cap)
    unsubscribe()
  }
}

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
  // Bumped when tokens change, purely to make React render again. Deliberately not a key:
  // keying the root remounts it, and a remount resets the router.
  const [, setApplied] = useState(0)

  useEffect(
    () =>
      startBranding(
        () => setSettled(true),
        () => setApplied((n) => n + 1),
      ),
    [],
  )

  return settled
}
