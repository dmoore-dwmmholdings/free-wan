import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '@free-wan/shared'
import { api, ApiError } from './api'
import { clearSession, getServerUrl, getToken, normalizeServerUrl, saveSession, subscribeSession } from './session'

/** Resolves once secure storage has been read, so the router can pick a first screen. */
export function useStoredSession() {
  const [state, setState] = useState<{ ready: boolean; server: string | null; token: string | null }>({
    ready: false,
    server: null,
    token: null,
  })
  useEffect(() => {
    let alive = true
    const sync = async () => {
      const [server, token] = await Promise.all([getServerUrl(), getToken()])
      if (alive) setState({ ready: true, server, token })
    }
    void sync()
    // Re-read whenever the session changes, so signing in or out moves the gate immediately.
    const unsubscribe = subscribeSession(() => void sync())
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  return state
}

export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: Me }>('/api/auth/me').then((r) => r.user),
    enabled,
    retry: false,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { server: string; username: string; password: string }) => {
      const server = normalizeServerUrl(input.server)
      if (!server) throw new ApiError(0, 'bad_server', 'Enter a valid server address')

      // Pre-seed the server so api.post can build an absolute URL for this very call.
      await saveSession(server, '')
      const res = await fetch(`${server}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          client: 'native',
        }),
      })
      const text = await res.text()
      const data: unknown = text ? JSON.parse(text) : undefined
      if (!res.ok) {
        await clearSession()
        const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error
        throw new ApiError(res.status, err?.code ?? 'internal', err?.message ?? 'Login failed')
      }
      const { user, token } = data as { user: Me; token?: string }
      if (!token) throw new ApiError(500, 'no_token', 'Server did not issue a token — is it up to date?')
      await saveSession(server, token)
      return user
    },
    onSuccess: (user) => qc.setQueryData(['me'], user),
  })
}

/** Change your own password. The server answers 204, so there is nothing to read back. */
export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post<void>('/api/auth/password', body),
    // Clearing mustChangePassword is what releases the gate, so re-read who we are.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // Best-effort: revoke server-side, but always drop the local token.
      try {
        await api.post('/api/auth/logout')
      } catch {
        /* offline or already revoked */
      }
      await clearSession()
    },
    onSuccess: () => qc.clear(),
  })
}
