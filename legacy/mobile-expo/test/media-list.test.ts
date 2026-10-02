import { describe, it, expect, beforeEach, vi } from 'vitest'

const SERVER = 'https://media.example.com'

function respond(body: unknown) {
  return {
    status: 200,
    ok: true,
    statusText: '',
    text: async () => JSON.stringify(body),
  } as Response
}

async function fresh() {
  vi.resetModules()
  const session = await import('@/lib/session')
  await session.saveSession(SERVER, 'token-abc')
  const media = await import('@/lib/media')
  return { media }
}

/** Run the options' queryFn against a stubbed fetch and return the URL it asked for. */
async function urlFor(
  options: { queryFn: (ctx: { pageParam: string | undefined }) => Promise<unknown> },
  pageParam?: string,
) {
  const fetchMock = vi.fn(async (_url: string) => respond({ data: [], nextCursor: null, total: 0 }))
  vi.stubGlobal('fetch', fetchMock)
  await options.queryFn({ pageParam })
  return new URL(fetchMock.mock.calls[0]![0])
}

describe('library pagination', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('stops paging when the server reports no next cursor', async () => {
    const { media } = await fresh()
    const options = media.mediaListQueryOptions()
    // Returning null rather than undefined here would leave hasNextPage true, and the list
    // would keep asking for a page that does not exist.
    expect(options.getNextPageParam({ data: [], nextCursor: null, total: 0 })).toBeUndefined()
  })

  it('carries the cursor forward for the next page', async () => {
    const { media } = await fresh()
    const options = media.mediaListQueryOptions()
    expect(options.getNextPageParam({ data: [], nextCursor: 'eyJvIjo0MH0', total: 95 })).toBe(
      'eyJvIjo0MH0',
    )

    const url = await urlFor(options, 'eyJvIjo0MH0')
    expect(url.searchParams.get('cursor')).toBe('eyJvIjo0MH0')
    expect(url.searchParams.get('limit')).toBe('40')
  })

  it('asks for the first page without a cursor', async () => {
    const { media } = await fresh()
    const url = await urlFor(media.mediaListQueryOptions())
    expect(url.searchParams.has('cursor')).toBe(false)
  })

  it('sends repeated tag params so the server ANDs them', async () => {
    const { media } = await fresh()
    const url = await urlFor(media.mediaListQueryOptions({ tags: ['a', 'b'] }))
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b'])
  })

  // The failure this guards is silent and severe: two filters sharing a cache key means one
  // shows the other's results. Every filter has to be part of the key.
  it.each([
    ['q', { q: 'holiday' }],
    ['liked', { liked: true }],
    ['category', { category: 'cat-1' }],
    ['collection', { collection: 'col-1' }],
    ['type', { type: 'video' as const }],
    ['tags', { tags: ['t-1'] }],
  ])('gives %s its own cache key', async (_name, params) => {
    const { media } = await fresh()
    const base = JSON.stringify(media.mediaListQueryOptions().queryKey)
    const filtered = JSON.stringify(media.mediaListQueryOptions(params).queryKey)
    expect(filtered).not.toBe(base)
  })

  it('does not let one filter value read another’s cached page', async () => {
    const { media } = await fresh()
    const a = JSON.stringify(media.mediaListQueryOptions({ category: 'cat-a' }).queryKey)
    const b = JSON.stringify(media.mediaListQueryOptions({ category: 'cat-b' }).queryKey)
    expect(a).not.toBe(b)
  })
})

describe('ordering the library', () => {
  it('asks the server for the ordering that was chosen', async () => {
    const { media } = await fresh()
    const url = await urlFor(media.mediaListQueryOptions({ sort: 'title', order: 'asc' }))
    expect(url.searchParams.get('sort')).toBe('title')
    expect(url.searchParams.get('order')).toBe('asc')
  })

  it('asks for nothing when no ordering was chosen, leaving the server its own default', async () => {
    const { media } = await fresh()
    const url = await urlFor(media.mediaListQueryOptions({}))
    expect(url.searchParams.has('sort')).toBe(false)
    expect(url.searchParams.has('order')).toBe(false)
  })

  it('keeps each ordering in its own cache', async () => {
    // The same hazard the filters have: a shared key would show one ordering the results of
    // another, and the list would simply look wrong with nothing to explain it.
    const { media } = await fresh()
    const newest = JSON.stringify(media.mediaListQueryOptions({ sort: 'added', order: 'desc' }).queryKey)
    const oldest = JSON.stringify(media.mediaListQueryOptions({ sort: 'added', order: 'asc' }).queryKey)
    const byTitle = JSON.stringify(media.mediaListQueryOptions({ sort: 'title', order: 'asc' }).queryKey)
    expect(new Set([newest, oldest, byTitle]).size).toBe(3)
  })

  it('offers the same orderings as the web app, starting on the server default', async () => {
    const { media } = await fresh()
    expect(media.SORT_CHOICES.map((c: { id: string }) => c.id)).toEqual([
      'added:desc', 'added:asc', 'title:asc', 'title:desc', 'duration:desc', 'duration:asc', 'popularity:desc',
    ])
    expect(media.DEFAULT_SORT.id).toBe('added:desc')
  })
})

describe('the cache key for a set of tags', () => {
  it('does not depend on the order they were tapped in', async () => {
    // The screen appends each tag as it is chosen, so the same pair reached two ways is two
    // orders. Left alone that is two cache entries and two trips for the same results.
    const { media } = await fresh()
    const oneWay = JSON.stringify(media.mediaListQueryOptions({ tags: ['b', 'a'] }).queryKey)
    const other = JSON.stringify(media.mediaListQueryOptions({ tags: ['a', 'b'] }).queryKey)
    expect(oneWay).toBe(other)
  })

  it('still tells different sets of tags apart', async () => {
    const { media } = await fresh()
    const ab = JSON.stringify(media.mediaListQueryOptions({ tags: ['a', 'b'] }).queryKey)
    const ac = JSON.stringify(media.mediaListQueryOptions({ tags: ['a', 'c'] }).queryKey)
    const a = JSON.stringify(media.mediaListQueryOptions({ tags: ['a'] }).queryKey)
    expect(new Set([ab, ac, a]).size).toBe(3)
  })

  it('still asks the server for every tag', async () => {
    const { media } = await fresh()
    const url = await urlFor(media.mediaListQueryOptions({ tags: ['b', 'a'] }))
    expect(url.searchParams.getAll('tag').sort()).toEqual(['a', 'b'])
  })
})
