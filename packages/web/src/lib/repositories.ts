import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  RepositoryDto,
  CreateRepositoryRequest,
  UpdateRepositoryRequest,
} from '@free-wan/shared'
import { api } from './api'

const REPOS_KEY = ['repositories'] as const

/** Admin list of repositories; polled so status/itemCount stay fresh during scans. */
export function useRepositories() {
  return useQuery({
    queryKey: REPOS_KEY,
    queryFn: () => api.get<{ data: RepositoryDto[] }>('/api/admin/repositories'),
    refetchInterval: 5000,
  })
}

export function useCreateRepository() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateRepositoryRequest) =>
      api.post<RepositoryDto>('/api/admin/repositories', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: REPOS_KEY }),
  })
}

export function useUpdateRepository() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRepositoryRequest }) =>
      api.patch<RepositoryDto>(`/api/admin/repositories/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: REPOS_KEY }),
  })
}

export function useDeleteRepository() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/admin/repositories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: REPOS_KEY }),
  })
}

export function useScanRepository() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, full }: { id: string; full?: boolean }) =>
      api.post<{ jobId: string }>(`/api/admin/repositories/${id}/scan`, { full: full ?? false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: REPOS_KEY }),
  })
}
