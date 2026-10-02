/** Where the auth gate should send someone, or null to leave them where they are. */
export type GateDestination = '/login' | '/change-password' | '/'

export interface GateState {
  /** Whether stored session state has been read yet. Nothing is decided before it has. */
  ready: boolean
  signedIn: boolean
  /**
   * Only a positive answer blocks. Before `/api/auth/me` answers, and when it cannot answer
   * at all, this is false — see the note in `gateRedirect` about what that does and does not
   * buy.
   */
  mustChangePassword: boolean
  /** First path segment of the current route: 'login', 'change-password', or something else. */
  segment: string | undefined
  /**
   * The route someone was headed for when the gate turned them away, if there was one. Absolute,
   * as `usePathname` reports it.
   */
  pendingRoute?: string | null
}

/**
 * The route the gate turned someone away from, held between the redirect out and the redirect
 * back. Module-level because the two are different renders of different screens with nothing
 * between them to carry it.
 */
let pending: string | null = null

/** Called by the gate as it sends someone to sign in. */
export function rememberRoute(path: string): void {
  pending = path
}

export function pendingRoute(): string | null {
  return pending
}

export function clearPendingRoute(): void {
  pending = null
}

/**
 * Where to put someone once the gate lets them through a sign-in.
 *
 * Straight to `/` was wrong in two ordinary situations. Following a `freewan://` link to an item
 * while signed out — a first install, or a link from someone else — opened the library, because
 * signing in navigated to the library and nothing had kept hold of what was actually asked for.
 * And a session that expires mid-use ends the same way: the 401 clears the session, the gate
 * sends you to sign in, and signing back in drops you at the library rather than the video you
 * were halfway through.
 *
 * This app has met this failure before from a different direction — `useBranding` records a
 * remount discarding a deep link "a moment after it arrived", and is built the way it is to
 * avoid it. This is the same loss with a different cause.
 *
 * The two gate screens are never a destination: returning to one would put someone back where
 * they just came from, and returning to `/change-password` in particular would ask again for a
 * change that has already happened.
 */
export function resumeDestination(route: string | null | undefined): string {
  // A single leading slash, and only one. `//host` is a protocol-relative URL, not a route of
  // ours — it passes a bare `startsWith('/')` and then means somewhere else entirely.
  if (!route || !route.startsWith('/') || route.startsWith('//')) return '/'
  const first = route.split('/')[1] ?? ''
  if (first === 'login' || first === 'change-password') return '/'
  return route
}

/**
 * The whole of the gate's decision, kept separate from the effect that acts on it so every
 * branch can be tested. Returning null rather than a destination matters as much as the
 * redirects do: a gate that always returns somewhere replaces the route on every render and
 * the app never settles.
 *
 * On `mustChangePassword`: the server does **not** enforce this. `authenticate` checks the
 * session and the role and nothing else, so the flag is advisory and both clients honour it
 * by choice. Treating an unknown answer as "not blocked" is therefore a real decision and not
 * a formality — it keeps someone's downloads reachable when their server is not, at the cost
 * of not forcing the change until the app can ask.
 */
export function gateRedirect(state: GateState): string | null {
  const { ready, signedIn, mustChangePassword, segment } = state
  if (!ready) return null

  const onLogin = segment === 'login'
  const onChangePassword = segment === 'change-password'

  if (!signedIn) return onLogin ? null : '/login'
  // The web app blocks every route until the starting password is replaced; this app has to
  // agree, or the phone is the way around it.
  if (mustChangePassword) return onChangePassword ? null : '/change-password'
  // Signed in and unblocked: the two gate screens are the only places to leave, and where they
  // lead is whatever was being asked for when the gate intervened.
  return onLogin || onChangePassword ? resumeDestination(state.pendingRoute) : null
}
