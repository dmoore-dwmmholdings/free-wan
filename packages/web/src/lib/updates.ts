import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export interface UpdateHistoryItem {
  version: string
  changelog: string | null
  status: 'applying' | 'pending_restart' | 'success' | 'failed' | 'rolled_back'
  appliedAt: number
  note: string | null
}

export interface UpdatesInfo {
  current: string
  supervised: boolean
  inProgress: boolean
  history: UpdateHistoryItem[]
}

export function useUpdates() {
  return useQuery({ queryKey: ['updates'], queryFn: () => api.get<UpdatesInfo>('/api/admin/updates') })
}

export function useUploadUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('package', file)
      return api.upload<{ version: string; restarting: boolean }>('/api/admin/updates', form)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['updates'] }),
  })
}
