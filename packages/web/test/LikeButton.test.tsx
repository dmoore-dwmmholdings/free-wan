import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LikeButton } from '../src/components/LikeButton'

function mockFetch(body: unknown) {
  return vi.fn(async () => ({ status: 200, ok: true, text: async () => JSON.stringify(body), statusText: 'ok' }))
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('LikeButton', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('PUTs a like when not yet liked', async () => {
    const f = mockFetch({ liked: true, likeCount: 1 })
    vi.stubGlobal('fetch', f)
    wrap(<LikeButton id="abc" liked={false} likeCount={0} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(f).toHaveBeenCalled())
    const [url, opts] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/media/abc/like')
    expect(opts.method).toBe('PUT')
  })

  it('DELETEs when already liked', async () => {
    const f = mockFetch({ liked: false, likeCount: 0 })
    vi.stubGlobal('fetch', f)
    wrap(<LikeButton id="abc" liked={true} likeCount={3} />)
    expect(screen.getByText('3')).toBeTruthy() // shows the count
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe('DELETE')
  })
})
