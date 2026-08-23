import { getServerUrl, getToken, clearSession } from './session'

/** Thrown for any non-2xx API response, carrying the server error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Absolute URL for an API path against the configured server. Native clients have no origin,
 * so every request — including ones handed to expo-video and expo-file-system — needs this.
 */
export async function apiUrl(path: string): Promise<string> {
  const base = await getServerUrl()
  if (!base) throw new ApiError(0, 'no_server', 'No FreeWAN server configured')
  return `${base}${path}`
}

/** Auth headers for requests issued outside fetch (expo-video, expo-file-system). */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = await apiUrl(path)
  const headers: Record<string, string> = { ...(await authHeaders()) }
  if (body !== undefined) headers['content-type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    // A revoked or expired session must not leave a dead token in secure storage, or the app
    // reopens to a browse screen that 401s on every tile.
    if (res.status === 401) await clearSession()
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error
    throw new ApiError(res.status, err?.code ?? 'internal', err?.message ?? res.statusText)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}
