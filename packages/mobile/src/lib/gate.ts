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
export function gateRedirect(state: GateState): GateDestination | null {
  const { ready, signedIn, mustChangePassword, segment } = state
  if (!ready) return null

  const onLogin = segment === 'login'
  const onChangePassword = segment === 'change-password'

  if (!signedIn) return onLogin ? null : '/login'
  // The web app blocks every route until the starting password is replaced; this app has to
  // agree, or the phone is the way around it.
  if (mustChangePassword) return onChangePassword ? null : '/change-password'
  // Signed in and unblocked: the two gate screens are the only places to leave.
  return onLogin || onChangePassword ? '/' : null
}
