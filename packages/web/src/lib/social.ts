import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CollectionDto, LikeResponse } from '@free-wan/shared'
import { api } from './api'

export function useToggleLike() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) =>
      liked
        ? api.del<LikeResponse>(`/api/media/${id}/like`)
        : api.put<LikeResponse>(`/api/media/${id}/like`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] })
      void qc.invalidateQueries({ queryKey: ['media-detail'] })
    },
  })
}

export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<{ data: CollectionDto[] }>('/api/collections'),
  })
}

export function useCreateCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string }) => api.post<CollectionDto>('/api/collections', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  })
}

export function useDeleteCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/collections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  })
}

export function useAddToCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ collectionId, mediaItemId }: { collectionId: string; mediaItemId: string }) =>
      api.post<void>(`/api/collections/${collectionId}/items`, { mediaItemId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  })
}
