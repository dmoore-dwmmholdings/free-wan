import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export interface UploadTarget {
  id: string
  name: string
  type: 'image' | 'mixed'
}

export interface UploadResult {
  uploaded: number
  files: string[]
  skipped: Array<{ name: string; reason: string }>
}

/** Writable, image-capable repositories a user can upload into. */
export function useUploadTargets() {
  return useQuery({
    queryKey: ['upload-targets'],
    queryFn: () => api.get<{ data: UploadTarget[] }>('/api/upload/targets'),
  })
}

export function useUploadPhotos() {
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
