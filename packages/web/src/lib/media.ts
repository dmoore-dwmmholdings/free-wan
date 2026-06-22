import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type {
  MediaListResponse,
  MediaDetail,
  CategoryNodeDto,
  PlaybackDescriptor,
} from '@free-wan/shared'
import { api } from './api'

/** A category plus its ancestor chain (for breadcrumbs); shape of GET /api/categories/:id. */
export interface CategoryDetail {
  id: string
  name: string
  path: string
  depth: number
  itemCount: number
  repositoryId: string
  ancestors: Array<{ id: string; name: string; path: string }>
}

export function usePlayback(id: string) {
  return useQuery({
    queryKey: ['playback', id],
    queryFn: () => api.get<PlaybackDescriptor>(`/api/media/${id}/playback`),
  })
}

export function useMediaList(search: string) {
  return useQuery({
    queryKey: ['media', search],
    queryFn: () => api.get<MediaListResponse>(`/api/media?${search}`),
  })
}

/** Paginated library feed: follows `nextCursor` so the whole repo is reachable, not just page 1. */
export function useInfiniteMediaList(search: string) {
  return useInfiniteQuery({
    queryKey: ['media-infinite', search],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams(search)
      if (pageParam) sp.set('cursor', pageParam)
      return api.get<MediaListResponse>(`/api/media?${sp.toString()}`)
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** Child categories of `parent` (or repository roots when null), scoped to repo type(s). */
export function useCategoryChildren(parent: string | null, repositoryType: string[] = []) {
  const sp = new URLSearchParams()
  if (parent) sp.set('parent', parent)
  for (const t of repositoryType) sp.append('repositoryType', t)
  const qs = sp.toString()
  return useQuery({
    queryKey: ['categories', qs],
    queryFn: () => api.get<{ data: CategoryNodeDto[] }>(`/api/categories${qs ? `?${qs}` : ''}`),
  })
}

/** A category with its ancestor chain, for breadcrumbs. Disabled when id is null. */
export function useCategoryDetail(id: string | null) {
  return useQuery({
    queryKey: ['category-detail', id],
    enabled: !!id,
    queryFn: () => api.get<CategoryDetail>(`/api/categories/${id}`),
  })
}

export function useMediaDetail(id: string) {
  return useQuery({
    queryKey: ['media-detail', id],
    queryFn: () => api.get<MediaDetail>(`/api/media/${id}`),
  })
}

export function useRootCategories() {
  return useQuery({
    queryKey: ['categories', 'root'],
    queryFn: () => api.get<{ data: CategoryNodeDto[] }>('/api/categories'),
  })
}

export function formatDuration(s: number | null): string | null {
  if (!s || s <= 0) return null
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function rawUrl(id: string, w?: number): string {
  return w ? `/api/media/${id}/raw?w=${w}` : `/api/media/${id}/raw`
}

export function resolutionLabel(h: number | null): string | null {
  if (!h) return null
  if (h >= 2160) return '4K'
  if (h >= 1080) return '1080p'
  if (h >= 720) return '720p'
  return 'SD'
}
