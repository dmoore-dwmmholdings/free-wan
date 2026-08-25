/**
 * Stands in for `react-native`, which cannot load under Node — it reaches into the native
 * module registry at import time.
 *
 * Only what the modules under `src/lib` import is here; the components import far more, and no
 * test loads one. `stubs.test.ts` holds this file to exactly that, because the gap it closes was
 * silent: `progress.ts` began importing `AppState` and this stub did not provide it, so the name
 * arrived as `undefined` and every test went on passing. Nothing broke only because the one
 * function that touches it is a hook, and there is no renderer here to call it. A test that did
 * call it would have failed on `undefined.addEventListener` for a reason that had nothing to do
 * with what it was testing.
 *
 * `setColorScheme` records rather than acts, so a test can check the scheme follows the branding
 * that was applied. It is spelled as an own property because production code checks
 * `typeof Appearance.setColorScheme === 'function'` before calling it — the guard that exists
 * because react-native-web has no such function.
 */
export const Appearance = {
  schemes: [] as string[],
  setColorScheme(scheme: string): void {
    Appearance.schemes.push(scheme)
  },
}

type AppStateListener = (status: string) => void

/**
 * Records its listeners rather than subscribing to anything, and hands back the same
 * `{ remove }` shape the real one does — that shape is what the callers store and call, so a
 * stub that omitted it would pass a subscription and fail a teardown.
 */
export const AppState = {
  listeners: [] as AppStateListener[],
  addEventListener(_type: string, listener: AppStateListener): { remove: () => void } {
    AppState.listeners.push(listener)
    return {
      remove(): void {
        const at = AppState.listeners.indexOf(listener)
        if (at !== -1) AppState.listeners.splice(at, 1)
      },
    }
  },
  /** Drive every listener, as the platform would on a change of state. */
  emit(status: string): void {
    for (const l of [...AppState.listeners]) l(status)
  },
  reset(): void {
    AppState.listeners.length = 0
  },
}

export type AppStateStatus = 'active' | 'background' | 'inactive'
