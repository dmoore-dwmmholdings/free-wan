import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useLogin, useMe } from '../lib/auth'
import { ApiError } from '../lib/api'
import { AuthCard, Field, SubmitButton, ErrorText } from '../components/AuthCard'

export function LoginPage() {
  const { data: me, isLoading } = useMe()
  const login = useLogin()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!isLoading && me) {
    return <Navigate to={me.mustChangePassword ? '/change-password' : '/'} replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const { user } = await login.mutateAsync({ username, password })
      navigate(user.mustChangePassword ? '/change-password' : '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    }
  }

  return (
    <AuthCard title="Sign in to your media">
      <form onSubmit={onSubmit}>
        <ErrorText>{error}</ErrorText>
        <Field
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <SubmitButton disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </SubmitButton>
      </form>
    </AuthCard>
  )
}
