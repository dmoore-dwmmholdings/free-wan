import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommandDto, AdminCommandDto, CommandRunDto, CreateCommandRequest, UpdateCommandRequest } from '@free-wan/shared'
import { api } from './api'

export function useCommands() {
  return useQuery({ queryKey: ['commands'], queryFn: () => api.get<{ data: CommandDto[] }>('/api/commands') })
}

/** Admin view: every command plus the server's executable allowlist (for the editor's picker). */
export function useAdminCommands() {
  return useQuery({
    queryKey: ['admin-commands'],
    queryFn: () => api.get<{ data: AdminCommandDto[]; executables: string[] }>('/api/admin/commands'),
  })
}

function useCommandInvalidation() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin-commands'] })
    void qc.invalidateQueries({ queryKey: ['commands'] })
  }
}

export function useCreateCommand() {
  const invalidate = useCommandInvalidation()
  return useMutation({
    mutationFn: (body: CreateCommandRequest) => api.post<AdminCommandDto>('/api/admin/commands', body),
    onSuccess: invalidate,
  })
}

export function useUpdateCommand() {
  const invalidate = useCommandInvalidation()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCommandRequest }) =>
      api.patch<AdminCommandDto>(`/api/admin/commands/${id}`, body),
    onSuccess: invalidate,
  })
}

export function useDeleteCommand() {
  const invalidate = useCommandInvalidation()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/admin/commands/${id}`),
    onSuccess: invalidate,
  })
}

export function useRunCommand() {
  return useMutation({
    mutationFn: ({ id, args }: { id: string; args: Record<string, unknown> }) =>
      api.post<{ runId: string }>(`/api/commands/${id}/run`, { args }),
  })
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<CommandRunDto>(`/api/command-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'queued' || s === 'running' ? 800 : false
    },
  })
}

export function cancelRun(runId: string) {
  return api.post(`/api/command-runs/${runId}/cancel`)
}
