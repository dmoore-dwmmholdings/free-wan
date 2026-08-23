import { describe, expect, it } from 'vitest'
import { QueryClient, type InfiniteData } from '@tanstack/react-query'
import type { MediaCard, MediaDetail, MediaListResponse } from '@free-wan/shared'
import { patchCachedLists } from '@/lib/social'

const card = (id: string, liked = false, likeCount = 0): MediaCard => ({
  id,
  type: 'video',
  title: id,
  durationS: 10,
  width: null,
  height: null,
  posterUrl: `/api/media/${id}/poster`,
  repositoryId: 'repo-1',
  categoryPath: null,
  liked,
  likeCount,
})

const page = (...cards: MediaCard[]): MediaListResponse => ({
  data: cards,
  nextCursor: null,
  total: cards.length,
})

function clientWithLibrary() {
  const qc = new QueryClient()
  qc.setQueryData<InfiniteData<MediaListResponse>>(['media', { category: null, tags: [] }], {
    pages: [page(card('a'), card('b')), page(card('c'))],
    pageParams: [undefined, 'cursor-1'],
  })
  return qc
}

const pagesOf = (qc: QueryClient) =>
  qc.getQueryData<InfiniteData<MediaListResponse>>(['media', { category: null, tags: [] }])!

describe('writing a like into the cached library', () => {
  it('updates the item on whichever page it is on', () => {
    const qc = clientWithLibrary()
    // Deliberately an item on the second page: an implementation that only patched the first
    // would look right in every hand test, because nobody scrolls in a hand test.
    patchCachedLists(qc, 'c', true, 5)
    expect(pagesOf(qc).pages[1]!.data[0]).toMatchObject({ id: 'c', liked: true, likeCount: 5 })
  })

  it('leaves every other item alone', () => {
    const qc = clientWithLibrary()
    patchCachedLists(qc, 'a', true, 1)
    expect(pagesOf(qc).pages[0]!.data[1]).toMatchObject({ id: 'b', liked: false, likeCount: 0 })
    expect(pagesOf(qc).pages[1]!.data[0]).toMatchObject({ id: 'c', liked: false, likeCount: 0 })
  })

  it('keeps the page structure intact', () => {
    const qc = clientWithLibrary()
    patchCachedLists(qc, 'a', true, 1)
    const data = pagesOf(qc)
    expect(data.pages).toHaveLength(2)
    expect(data.pageParams).toEqual([undefined, 'cursor-1'])
    expect(data.pages[0]!.total).toBe(2)
  })

  it('does not corrupt the detail query, which shares the key prefix', () => {
    // ['media'] with exact:false also matches ['media', id], which is a MediaDetail and has
    // no `pages`. Treating it as paged would replace the detail with a malformed object and
    // the screen would render nothing.
    const qc = clientWithLibrary()
    const detail = { id: 'a', title: 'a', liked: false, likeCount: 0 } as unknown as MediaDetail
    qc.setQueryData<MediaDetail>(['media', 'a'], detail)

    patchCachedLists(qc, 'a', true, 1)

    expect(qc.getQueryData<MediaDetail>(['media', 'a'])).toEqual(detail)
  })

  it('patches every cached filter, not just the one on screen', () => {
    // The grid, the liked-only view and a folder view are separate cache entries. A like made
    // in one has to be true in all of them, or going back shows the old heart.
    const qc = clientWithLibrary()
    qc.setQueryData<InfiniteData<MediaListResponse>>(['media', { liked: true, tags: [] }], {
      pages: [page(card('a'))],
      pageParams: [undefined],
    })

    patchCachedLists(qc, 'a', true, 3)

    const likedOnly = qc.getQueryData<InfiniteData<MediaListResponse>>([
      'media',
      { liked: true, tags: [] },
    ])!
    expect(likedOnly.pages[0]!.data[0]).toMatchObject({ liked: true, likeCount: 3 })
    expect(pagesOf(qc).pages[0]!.data[0]).toMatchObject({ liked: true, likeCount: 3 })
  })
})
