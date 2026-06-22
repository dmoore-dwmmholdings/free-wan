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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })

  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : undefined

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error
    throw new ApiError(res.status, err?.code ?? 'internal', err?.message ?? res.statusText)
  }
  return data as T
}

/** Multipart POST (file uploads). The browser sets the content-type + boundary. */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data: unknown = text ? JSON.parse(text) : undefined
  if (!res.ok) {
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
  upload,
}
