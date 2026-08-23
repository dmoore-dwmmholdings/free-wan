import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tag, TagWithCount, AddMediaTagRequest } from '@free-wan/shared'
import { api } from './api'

/** All tags with item counts (for the filter bar and the picker's autocomplete). */
export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api.get<{ data: TagWithCount[] }>('/api/tags') })
}

export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/tags/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tags'] })
      void qc.invalidateQueries({ queryKey: ['media-infinite'] })
    },
  })
}

export function useAddMediaTag(mediaId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddMediaTagRequest) => api.post<{ data: Tag[] }>(`/api/media/${mediaId}/tags`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media-detail', mediaId] })
      void qc.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}

export function useRemoveMediaTag(mediaId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tagId: string) => api.del<void>(`/api/media/${mediaId}/tags/${tagId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media-detail', mediaId] })
      void qc.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}
