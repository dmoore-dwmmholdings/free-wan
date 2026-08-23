import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'fw_token'
const SERVER_KEY = 'fw_server'

// Cached in memory so the hot paths (every request, every tile URL) don't hit the keychain.
let tokenCache: string | null | undefined
let serverCache: string | null | undefined

// Readers must be told when the session changes. Without this the auth gate keeps the value it
// read at mount, so a successful login leaves it still holding a null token and it bounces the
// user straight back to the login screen.
const listeners = new Set<() => void>()

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emitSessionChange(): void {
  for (const listener of listeners) listener()
}

/** Normalise a user-typed server address into an origin with no trailing slash. */
export function normalizeServerUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  // Bare hostnames are the common case on a tailnet ("media.tail1234.ts.net").
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    if (!url.hostname) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export async function getServerUrl(): Promise<string | null> {
  if (serverCache === undefined) serverCache = await SecureStore.getItemAsync(SERVER_KEY)
  return serverCache
}

export async function getToken(): Promise<string | null> {
  if (tokenCache === undefined) tokenCache = await SecureStore.getItemAsync(TOKEN_KEY)
  return tokenCache
}

export async function saveSession(serverUrl: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(SERVER_KEY, serverUrl)
  await SecureStore.setItemAsync(TOKEN_KEY, token)
  serverCache = serverUrl
  tokenCache = token
  emitSessionChange()
}

/** Drop the token but keep the server address — re-login should not retype the host. */
export async function clearSession(): Promise<void> {
  // Ending the session must not depend on storage cooperating. This runs on every 401, and
  // if the delete rejects the two lines below are what actually matter — without them the
  // in-memory token survives, no subscriber is told, and the auth gate leaves the user on a
  // screen whose retry can never succeed. A stale entry on disk is the lesser problem.
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
  } catch {
    /* keychain unavailable, or the key was already gone; the session is over either way */
  }
  tokenCache = null
  emitSessionChange()
}
