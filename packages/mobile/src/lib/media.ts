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

export function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}
