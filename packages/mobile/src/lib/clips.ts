import { useQuery } from '@tanstack/react-query'
import type { ClipDto, ClipPreview } from '@free-wan/shared'
import { api } from './api'

export function useClips() {
  return useQuery({
    queryKey: ['clips'],
    queryFn: () => api.get<{ data: ClipDto[] }>('/api/clips'),
  })
}

/** One clip, from the list query — the same shape the list already holds. */
export function useClip(id: string): ClipDto | undefined {
  const { data } = useClips()
  return data?.data.find((c) => c.id === id)
}

/** Where to play a clip from: the source stream, plus the in/out points. */
export function useClipPreview(id: string) {
  return useQuery({
    queryKey: ['clip-preview', id],
    queryFn: () => api.get<ClipPreview>(`/api/clips/${id}/preview`),
  })
}
