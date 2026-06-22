import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClipDto } from '@free-wan/shared'
import { api } from './api'

export function useClips() {
  return useQuery({ queryKey: ['clips'], queryFn: () => api.get<{ data: ClipDto[] }>('/api/clips') })
}

export function useCreateClip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { sourceItemId: string; name: string; startS: number; endS: number }) =>
      api.post<ClipDto>('/api/clips', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips'] }),
  })
}

export function useDeleteClip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/clips/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips'] }),
  })
}

export function useExportClip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, format }: { id: string; format: 'mp4' | 'gif' }) =>
      api.post<{ jobId: string }>(`/api/clips/${id}/export`, { format }),
    // The export is a background job; refresh shortly after to pick up the ready state.
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['clips'] }), 1500),
  })
}
