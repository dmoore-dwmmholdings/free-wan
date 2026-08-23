import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AdminPluginDto,
  PluginDto,
  PluginRunDto,
  UiView,
  UpdatePluginRequest,
} from '@free-wan/shared'
import { api } from './api'

// ---- user-facing ----
export function usePlugins() {
  return useQuery({ queryKey: ['plugins'], queryFn: () => api.get<{ data: PluginDto[] }>('/api/plugins') })
}

/** Render a plugin panel → block tree. Keyed so action mutations can seed the cache. When the
 *  panel declares refreshMs, the view is re-fetched on that interval for live progress — except
 *  while `paused` (the user is interacting with the form): a background refetch re-renders the
 *  panel, which closes an open native <select> and disrupts typing. Live progress resumes the
 *  moment focus leaves the form. */
export function usePanel(pluginId: string, panel: string, enabled = true, refreshMs?: number, paused = false) {
  return useQuery({
    queryKey: ['plugin-panel', pluginId, panel],
    queryFn: () => api.get<{ view: UiView }>(`/api/plugins/${pluginId}/panels/${panel}`),
    enabled,
    refetchInterval: !paused && refreshMs && refreshMs > 0 ? refreshMs : false,
    refetchOnWindowFocus: !paused,
  })
}

export function usePanelAction(pluginId: string, panel: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { action: string; value?: unknown; fields?: Record<string, unknown> }) =>
      api.post<{ view: UiView }>(`/api/plugins/${pluginId}/panels/${panel}/action`, body),
    onSuccess: (data) => qc.setQueryData(['plugin-panel', pluginId, panel], data),
  })
}

export function useRunPluginCommand(pluginId: string) {
  return useMutation({
    mutationFn: ({ command, args }: { command: string; args: Record<string, unknown> }) =>
      api.post<{ runId: string }>(`/api/plugins/${pluginId}/commands/${command}/run`, { args }),
  })
}

export function usePluginRun(pluginId: string, runId: string | null) {
  return useQuery({
    queryKey: ['plugin-run', pluginId, runId],
    queryFn: () => api.get<PluginRunDto>(`/api/plugins/${pluginId}/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'queued' || s === 'running' ? 700 : false
    },
  })
}

// ---- admin ----
export function useAdminPlugins() {
  return useQuery({
    queryKey: ['admin-plugins'],
    queryFn: () => api.get<{ data: AdminPluginDto[]; registryUrl: string | null; enabled: boolean }>('/api/admin/plugins'),
  })
}

function useAdminPluginInvalidation() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin-plugins'] })
    void qc.invalidateQueries({ queryKey: ['plugins'] })
  }
}

export function useInstallPlugin() {
  const invalidate = useAdminPluginInvalidation()
  return useMutation({
    mutationFn: (body: { source: 'path'; path: string } | { source: 'url'; url: string }) =>
      api.post<AdminPluginDto>('/api/admin/plugins/install', body),
    onSuccess: invalidate,
  })
}

export function useUploadPlugin() {
  const invalidate = useAdminPluginInvalidation()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload<AdminPluginDto>('/api/admin/plugins/install', form)
    },
    onSuccess: invalidate,
  })
}

export function useUpdatePlugin() {
  const invalidate = useAdminPluginInvalidation()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePluginRequest }) =>
      api.patch<AdminPluginDto>(`/api/admin/plugins/${id}`, body),
    onSuccess: invalidate,
  })
}

export function useUninstallPlugin() {
  const invalidate = useAdminPluginInvalidation()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/admin/plugins/${id}`),
    onSuccess: invalidate,
  })
}

export function usePluginRuns(pluginId: string | null) {
  return useQuery({
    queryKey: ['admin-plugin-runs', pluginId],
    queryFn: () => api.get<{ data: PluginRunDto[] }>(`/api/admin/plugins/${pluginId}/runs`),
    enabled: !!pluginId,
  })
}
