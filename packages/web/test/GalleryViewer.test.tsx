import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MediaCard } from '@free-wan/shared'
import { GalleryViewer } from '../src/components/GalleryViewer'
import { MediaPrefsProvider } from '../src/components/MediaPrefsProvider'

function renderInRouter(ui: React.ReactElement) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <MediaPrefsProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </MediaPrefsProvider>
    </QueryClientProvider>,
  )
}

const img = (id: string, title: string): MediaCard => ({
  id,
  type: 'image',
  title,
  durationS: null,
  width: 100,
  height: 100,
  posterUrl: `/p/${id}`,
  repositoryId: 'r',
  categoryPath: null,
  liked: false,
  likeCount: 0,
})
const items = [img('a', 'Alpha'), img('b', 'Bravo'), img('c', 'Charlie')]

describe('GalleryViewer', () => {
  afterEach(() => cleanup())

  it('shows the position indicator and navigates with arrow keys', () => {
    const { container } = renderInRouter(<GalleryViewer items={items} startIndex={0} onClose={() => {}} />)
    expect(container.textContent).toContain('1 / 3')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(container.textContent).toContain('2 / 3')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // clamps at the end
    expect(container.textContent).toContain('3 / 3')

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(container.textContent).toContain('2 / 3')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderInRouter(<GalleryViewer items={items} startIndex={0} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
