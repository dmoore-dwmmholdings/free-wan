import { describe, it, expect, beforeEach, vi } from 'vitest'

const SERVER = 'https://media.example.com'

function respond(status: number, body: string, statusText = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText,
    text: async () => body,
  } as Response
}

async function fresh() {
  vi.resetModules()
  const session = await import('@/lib/session')
  await session.saveSession(SERVER, 'token-abc')
  const api = await import('@/lib/api')
  return { api, session }
}

describe('API request layer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('sends the bearer token and an absolute URL', async () => {
    const { api } = await fresh()
    const fetchMock = vi.fn(async () => respond(200, '{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)

    await api.api.get('/api/media')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${SERVER}/api/media`)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-abc')
  })

  // Regression: the body was parsed before the status was checked, so a proxy's HTML error
  // page threw a SyntaxError that hid the status — and skipped the 401 handling below.
  it('reports the status when an error body is not JSON', async () => {
    const { api } = await fresh()
    vi.stubGlobal('fetch', async () => respond(502, '<html><body>Bad Gateway</body></html>', 'Bad Gateway'))

    await expect(api.api.get('/api/media')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      message: 'Bad Gateway',
    })
  })

  it('still clears the session on a 401 that is not JSON', async () => {
    const { api, session } = await fresh()
    vi.stubGlobal('fetch', async () => respond(401, 'Unauthorized'))

    await expect(api.api.get('/api/media')).rejects.toMatchObject({ status: 401 })
    expect(await session.getToken()).toBeNull()
  })

  it('uses the error envelope when the server does send one', async () => {
    const { api } = await fresh()
    vi.stubGlobal('fetch', async () =>
      respond(404, JSON.stringify({ error: { code: 'not_found', message: 'Media not found' } })),
    )

    await expect(api.api.get('/api/media/x')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Media not found',
    })
  })

  it('returns nothing for 204 without touching the body', async () => {
    const { api } = await fresh()
    vi.stubGlobal('fetch', async () => respond(204, ''))
    await expect(api.api.post('/api/media/x/progress', { positionS: 1 })).resolves.toBeUndefined()
  })

  it('rejects rather than returning garbage when a success body is unreadable', async () => {
    const { api } = await fresh()
    vi.stubGlobal('fetch', async () => respond(200, 'not json at all'))
    await expect(api.api.get('/api/media')).rejects.toMatchObject({ code: 'bad_response' })
  })
})
