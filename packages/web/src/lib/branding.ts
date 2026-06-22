import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Branding, UpdateBrandingRequest } from '@free-wan/shared'
import { api } from './api'

export function useBranding() {
  return useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get<Branding>('/api/branding'),
    staleTime: 60_000,
  })
}

export function useUpdateBranding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: UpdateBrandingRequest) => api.put<Branding>('/api/admin/branding', b),
    onSuccess: (data) => qc.setQueryData(['branding'], data),
  })
}

export function useUploadAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ kind, file }: { kind: 'logo' | 'favicon'; file: File }) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/branding/asset?kind=${kind}`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('upload failed')
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branding'] }),
  })
}
