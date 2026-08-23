import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { MediaDetail, MediaListResponse, PlaybackDescriptor } from '@free-wan/shared'
import { api } from './api'

export function useMediaList(params: { q?: string; liked?: boolean; category?: string | null } = {}) {
  return useInfiniteQuery({
    queryKey: ['media', params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: '40' })
      if (params.q) qs.set('q', params.q)
      if (params.liked) qs.set('liked', 'true')
      if (params.category) qs.set('category', params.category)
      if (pageParam) qs.set('cursor', pageParam)
      return api.get<MediaListResponse>(`/api/media?${qs}`)
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
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
