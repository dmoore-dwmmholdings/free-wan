import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'fw_token'
const SERVER_KEY = 'fw_server'

// Cached in memory so the hot paths (every request, every tile URL) don't hit the keychain.
let tokenCache: string | null | undefined
let serverCache: string | null | undefined

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
}

/** Drop the token but keep the server address — re-login should not retype the host. */
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
  tokenCache = null
}
