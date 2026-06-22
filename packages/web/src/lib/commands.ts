import { useMutation, useQuery } from '@tanstack/react-query'
import type { CommandDto, CommandRunDto } from '@free-wan/shared'
import { api } from './api'

export function useCommands() {
  return useQuery({ queryKey: ['commands'], queryFn: () => api.get<{ data: CommandDto[] }>('/api/commands') })
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
