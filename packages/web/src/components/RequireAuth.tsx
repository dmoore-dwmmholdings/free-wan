import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useMe } from '../lib/auth'

/** Gate that requires a session and funnels forced-password-change users. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe()

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-muted">Loading…</main>
    )
  }
  if (!me) return <Navigate to="/login" replace />
  if (me.mustChangePassword) return <Navigate to="/change-password" replace />
  return <>{children}</>
}
