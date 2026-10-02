import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { MediaDetail, MediaListResponse, PlaybackDescriptor } from '@free-wan/shared'
import { api } from './api'

/** The orderings the server offers, paired the way they are offered to the reader. */
export interface SortChoice {
  /** Stable identity for the chosen ordering, and what the sheet marks as selected. */
  id: string
  label: string
  sort: 'title' | 'added' | 'created' | 'duration' | 'popularity'
  order: 'asc' | 'desc'
}

/**
 * The same seven the web app offers, in the same words. A library sorted differently in the
 * two places would be a small betrayal of the idea that this is the same library.
 */
export const SORT_CHOICES: SortChoice[] = [
  { id: 'added:desc', label: 'Newest', sort: 'added', order: 'desc' },
  { id: 'added:asc', label: 'Oldest', sort: 'added', order: 'asc' },
  { id: 'title:asc', label: 'Title A–Z', sort: 'title', order: 'asc' },
  { id: 'title:desc', label: 'Title Z–A', sort: 'title', order: 'desc' },
  { id: 'duration:desc', label: 'Longest', sort: 'duration', order: 'desc' },
  { id: 'duration:asc', label: 'Shortest', sort: 'duration', order: 'asc' },
  { id: 'popularity:desc', label: 'Most liked', sort: 'popularity', order: 'desc' },
]

/** What the server does without being asked, and so what the app starts on. */
export const DEFAULT_SORT = SORT_CHOICES[0]!

export interface MediaListParams {
  q?: string
  liked?: boolean
  category?: string | null
  collection?: string
  tags?: string[]
  type?: 'video' | 'image'
  /** Omitted inside a collection, which the server orders by position regardless. */
  sort?: SortChoice['sort']
  order?: SortChoice['order']
}

/**
 * Query options for a page of the library. Separate from the hook so the two things that fail
 * silently here can be tested: a query key that omits a filter would let one filter read
 * another's cached results, and a `getNextPageParam` that does not stop would page forever.
 */
export function mediaListQueryOptions(params: MediaListParams = {}) {
  // Tags are sorted before they reach the key. The screen holds them in the order they were
  // tapped, and the key is hashed from the object as given — so the same two tags picked in
  // the other order are a different key and a second trip for results already held. Toggling
  // one off and back on is enough to do it, since that moves it to the end of the list.
  const tags = params.tags && params.tags.length > 0 ? [...params.tags].sort() : params.tags
  const keyed = { ...params, ...(tags ? { tags } : {}) }
  return {
    queryKey: ['media', keyed] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const qs = new URLSearchParams({ limit: '40' })
      if (params.q) qs.set('q', params.q)
      if (params.liked) qs.set('liked', 'true')
      if (params.type) qs.set('type', params.type)
      if (params.category) qs.set('category', params.category)
      if (params.collection) qs.set('collection', params.collection)
      // Sent only when asked for, so the server's own default is what an unsorted list gets.
      if (params.sort) qs.set('sort', params.sort)
      if (params.order) qs.set('order', params.order)
      // Repeated `tag` params are AND-combined by the API.
      for (const t of params.tags ?? []) qs.append('tag', t)
      if (pageParam) qs.set('cursor', pageParam)
      return api.get<MediaListResponse>(`/api/media?${qs}`)
    },
    // The server sends null once the last page is served; returning undefined is what tells
    // TanStack there is nothing more, and is why the list stops rather than refetching the
    // final page forever.
    getNextPageParam: (last: MediaListResponse) => last.nextCursor ?? undefined,
  }
}

export function useMediaList(params: MediaListParams = {}) {
  return useInfiniteQuery(mediaListQueryOptions(params))
}

export function useMediaDetail(id: string) {
  return useQuery({
    queryKey: ['media', id],
    queryFn: () => api.get<MediaDetail>(`/api/media/${id}`),
  })
}

export function usePlayback(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['playback', id],
    queryFn: () => api.get<PlaybackDescriptor>(`/api/media/${id}/playback`),
    enabled,
  })
}

/**
 * A duration to put on a tile, or null when there is nothing worth saying.
 *
 * Anything under a second counts as nothing. Every photo in a library has a duration: ffprobe
 * reports a single frame as 0.04 seconds, and the guard used to be `<= 0`, so every photo tile
 * carried a badge reading `0:00` — and so did the line under a photo's title, and its row in
 * the Downloads tab. A label that rounds to zero has never told anyone anything; where a real
 * sub-second clip needs one, the clip screens fall back to tenths.
 */
export function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds < 1) return null
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** Requested widths are rounded up to a multiple of this, so the server caches a handful of
 *  variants rather than one per phone model. */
const WIDTH_STEP = 320

/** Above this a photo is not visibly better on a phone, and every pixel still costs. */
const MAX_WIDTH = 2560

/**
 * The width to ask `/api/media/:id/raw` for when showing a photo, or null to take the original.
 *
 * Without this the app asks for the original every time — the full 12-megapixel file off
 * someone's camera, downloaded over a tailnet and decoded into a phone's memory to be drawn
 * at a fraction of its size. The web app has always asked for a fitted size; the phone, which
 * is the device that actually pays for the difference, was asking for the largest thing on
 * offer. Measured against a 4032x3024 photo: 638 KB whole, 54 KB at 1280.
 *
 * Null rather than a width in two cases. When the source width is unknown there is no way to
 * tell whether a request would be a downscale or an upscale. And when it is known to be no
 * larger than what would be asked for, the original *is* the smaller file: the server resizes
 * with `scale=w:-2`, which enlarges just as happily as it shrinks, and would answer with a
 * bigger, softer image than the one it started from. Measured against a live server on a
 * 1600x1200 photo: 110 KB whole, 60 KB at 1280 — and 164 KB if 2560 is asked for, half again
 * as large as the original for no more detail than it started with. A tablet is what would ask,
 * since `supportsTablet` is on.
 */
export function displayWidthFor(input: {
  /** Screen width in density-independent points. */
  screenWidth: number
  pixelRatio: number
  sourceWidth: number | null
}): number | null {
  const { screenWidth, pixelRatio, sourceWidth } = input
  if (!sourceWidth || sourceWidth <= 0) return null
  const devicePixels = Math.max(1, screenWidth * pixelRatio)
  const bucketed = Math.ceil(devicePixels / WIDTH_STEP) * WIDTH_STEP
  const width = Math.min(MAX_WIDTH, bucketed)
  return width >= sourceWidth ? null : width
}
