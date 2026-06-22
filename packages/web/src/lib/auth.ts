import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me, LoginRequest, ChangePasswordRequest } from '@free-wan/shared'
import { api, ApiError } from './api'

const ME_KEY = ['me'] as const

/** Current identity, or `null` when not authenticated. */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const { user } = await api.get<{ user: Me }>('/api/auth/me')
        return user
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 30_000,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginRequest) => api.post<{ user: Me }>('/api/auth/login', body),
    onSuccess: (data) => qc.setQueryData(ME_KEY, data.user),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/api/auth/logout'),
    onSuccess: () => qc.setQueryData(ME_KEY, null),
  })
}

export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) => api.post<void>('/api/auth/password', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  })
}
