import { QueryClient } from '@tanstack/react-query'

/**
 * Shared TanStack Query defaults. Extracted from the root layout so the network-mode choice
 * below can be tested — it is the kind of setting whose failure is invisible in the UI.
 */
export const queryDefaults = {
  queries: {
    // A phone drops off the tailnet constantly; serve cached data rather than spinners.
    staleTime: 30_000,
    retry: 1,
    // The default 'online' mode gates every fetch and retry on `onlineManager`, which on
    // React Native only knows the truth if it is wired to NetInfo — this app does not wire
    // it, so its answer is a guess. A wrong guess does not merely delay a request: the retry
    // is *paused*, and a query paused before it ever recorded a result stays `pending`
    // forever, rendering as no data, no error and no spinner. Nothing revives it, not a
    // remount, a refocus or a tab switch. Seen for real: sign in after a 401 and the folder
    // chips never came back for the rest of the session.
    // Trying and failing is the right behaviour here anyway. Reaching this server depends on
    // the tailnet, not on whether the phone has an internet connection at all, so
    // connectivity is not something to be inferred — and a failure already surfaces as a
    // retryable error.
    networkMode: 'always',
  },
  // Same hazard, worse consequence: a paused mutation never reaches the server and never
  // reports that it did not.
  mutations: { networkMode: 'always' },
} as const

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: queryDefaults })
}
