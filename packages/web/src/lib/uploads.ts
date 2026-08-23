import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export interface UploadTarget {
  id: string
  name: string
  type: 'image' | 'video' | 'mixed'
}

export interface UploadResult {
  uploaded: number
  files: string[]
  skipped: Array<{ name: string; reason: string }>
}

/** Writable, media-capable repositories a user can upload into. */
export function useUploadTargets() {
  return useQuery({
    queryKey: ['upload-targets'],
    queryFn: () => api.get<{ data: UploadTarget[] }>('/api/upload/targets'),
  })
}

/** The HTML file-input `accept` value for a target type — what the OS picker should offer. */
export function acceptFor(type: UploadTarget['type'] | undefined): string {
  if (type === 'image') return 'image/*'
  if (type === 'video') return 'video/*'
  return 'image/*,video/*'
}

export function useUploadMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ repositoryId, files }: { repositoryId: string; files: File[] }) => {
      const form = new FormData()
      for (const f of files) form.append('files', f)
      return api.upload<UploadResult>(`/api/repositories/${repositoryId}/upload`, form)
    },
    onSuccess: () => {
      // A scan runs server-side; refetch the library and folders shortly after.
      qc.invalidateQueries({ queryKey: ['media-infinite'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
    },
  })
}
