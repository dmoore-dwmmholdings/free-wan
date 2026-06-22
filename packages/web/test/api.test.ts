import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError } from '../src/lib/api'

function mockFetch(status: number, body?: unknown) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    statusText: 'x',
  }))
}

describe('api client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('parses JSON on 200', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ok: 1 }))
    expect(await api.get('/x')).toEqual({ ok: 1 })
  })

  it('returns undefined on 204', async () => {
    vi.stubGlobal('fetch', mockFetch(204))
    expect(await api.post('/x')).toBeUndefined()
  })

  it('throws ApiError carrying status + code on non-2xx', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { error: { code: 'forbidden', message: 'no' } }))
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError)
    vi.stubGlobal('fetch', mockFetch(403, { error: { code: 'forbidden', message: 'no' } }))
    await expect(api.get('/x')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('sends a JSON body for post with content-type', async () => {
    const f = mockFetch(200, { ok: 1 })
    vi.stubGlobal('fetch', f)
    await api.post('/x', { a: 1 })
    const opts = f.mock.calls[0]![1] as RequestInit
    expect(opts.method).toBe('POST')
    expect(opts.body).toBe('{"a":1}')
    expect((opts.headers as Record<string, string>)['content-type']).toBe('application/json')
  })
})
