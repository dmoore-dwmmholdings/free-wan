import { useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { focusManager } from '@tanstack/react-query'

/**
 * Tell TanStack Query when the app comes back to the foreground.
 *
 * `refetchOnWindowFocus` is on by default, but on React Native nothing ever reports a focus
 * change unless `focusManager` is wired to `AppState` — there is no window to listen to. Left
 * alone the setting is simply inert, and the effect is quiet rather than obvious: the library
 * shows whatever it held when you last looked. For an app whose server you also use from a
 * browser, that means media uploaded, liked or newly scanned elsewhere stays invisible until
 * something is pulled to refresh.
 *
 * `staleTime` still applies, so switching apps for a moment costs nothing; only data that has
 * gone stale is fetched again.
 *
 * This is the sibling of the `onlineManager` wiring TanStack also expects on React Native.
 * That one is deliberately not used — see `networkMode` in `query.ts` — because guessing at
 * connectivity did harm. Here there is no such tradeoff: knowing the app was reopened is a
 * fact, not a guess.
 */
export function useRefetchOnForeground(): void {
  useEffect(() => {
    focusManager.setEventListener((handleFocus) => {
      const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
        handleFocus(status === 'active')
      })
      return () => subscription.remove()
    })
    return () => {
      // Hand focus tracking back to the default, so a remount does not stack listeners.
      focusManager.setEventListener(() => () => {})
    }
  }, [])
}
