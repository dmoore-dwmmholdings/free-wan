import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useChangePassword, useMe } from '../lib/auth'
import { ApiError } from '../lib/api'
import { AuthCard, Field, SubmitButton, ErrorText } from '../components/AuthCard'

export function ChangePasswordPage() {
  const { data: me, isLoading } = useMe()
  const change = useChangePassword()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!isLoading && !me) return <Navigate to="/login" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    try {
      await change.mutateAsync({ currentPassword, newPassword })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change password')
    }
  }

  const forced = me?.mustChangePassword ?? false

  return (
    <AuthCard title={forced ? 'Set a new password to continue' : 'Change your password'}>
      <form onSubmit={onSubmit}>
        <ErrorText>{error}</ErrorText>
        <Field
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
        <Field
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
        <Field
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        <SubmitButton disabled={change.isPending}>
          {change.isPending ? 'Saving…' : 'Update password'}
        </SubmitButton>
      </form>
    </AuthCard>
  )
}
