import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { MediaDetail, MediaListResponse, PlaybackDescriptor } from '@free-wan/shared'
import { api } from './api'

export interface MediaListParams {
  q?: string
  liked?: boolean
  category?: string | null
  collection?: string
  tags?: string[]
  type?: 'video' | 'image'
}

/**
 * Query options for a page of the library. Separate from the hook so the two things that fail
 * silently here can be tested: a query key that omits a filter would let one filter read
 * another's cached results, and a `getNextPageParam` that does not stop would page forever.
 */
export function mediaListQueryOptions(params: MediaListParams = {}) {
  return {
    queryKey: ['media', params] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const qs = new URLSearchParams({ limit: '40' })
      if (params.q) qs.set('q', params.q)
      if (params.liked) qs.set('liked', 'true')
      if (params.type) qs.set('type', params.type)
      if (params.category) qs.set('category', params.category)
      if (params.collection) qs.set('collection', params.collection)
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
 * bigger, softer image than the one it started from.
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
