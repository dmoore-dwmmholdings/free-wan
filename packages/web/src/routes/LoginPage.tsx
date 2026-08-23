import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useLogin, useMe } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Logo } from '../components/Logo'

function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
      <ellipse cx="9" cy="7" rx="8" ry="5.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="7" r="2.4" fill="currentColor" />
      {off && <line x1="2" y1="12" x2="16" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  )
}

export function LoginPage() {
  const { data: me, isLoading } = useMe()
  const login = useLogin()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [keep, setKeep] = useState(true)
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
    <div className="flex min-h-screen bg-bg text-ink">
      {/* Visual panel */}
      <div
        className="relative hidden flex-[1.15] flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: 'linear-gradient(145deg, color-mix(in srgb, var(--fw-primary) 24%, var(--fw-surface)), var(--fw-surface) 58%)' }}
      >
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-[360px] w-[360px] rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--fw-accent) 36%, transparent), transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-10 h-[240px] w-[240px] rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--fw-primary) 30%, transparent), transparent 72%)' }}
        />
        <div className="relative">
          <Logo size={38} textSize={22} pulse />
        </div>
        <div className="relative flex max-w-[460px] flex-col gap-4">
          <h1 className="font-head text-[42px] font-semibold leading-[1.04] tracking-[-0.02em]">
            Your library.
            <br />
            Every drive.
            <br />
            One private home.
          </h1>
          <p className="text-[15.5px] leading-relaxed text-muted">
            Video and photos, unified and searchable — reachable from any device on your tailnet, themed exactly the way you like.
          </p>
        </div>
        <div className="relative flex gap-[18px] font-mono text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--fw-accent)' }} />
            tailnet-only
          </span>
          <span>private</span>
          <span>runs on your own hardware</span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-12 sm:px-12">
        <form onSubmit={onSubmit} className="flex w-full max-w-[360px] flex-col gap-5">
          <div className="flex flex-col gap-1.5 lg:hidden">
            <Logo size={34} textSize={20} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="font-head text-[26px] font-semibold tracking-[-0.01em]">Sign in</div>
            <div className="text-[13.5px] text-muted">Welcome back to your library.</div>
          </div>

          {error && (
            <p className="rounded-theme-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
          )}

          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="fw-input"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Password</span>
            <div className="flex h-11 items-center gap-2.5 rounded-theme-sm border border-line bg-surface px-3.5 focus-within:border-primary">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="min-w-0 flex-1 border-none bg-transparent text-sm text-ink outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="flex-none text-muted hover:text-ink"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                <EyeIcon off={showPw} />
              </button>
            </div>
          </label>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setKeep((k) => !k)}
              className="flex items-center gap-2.5 text-[13px] text-ink"
            >
              <span
                className="relative inline-block h-5 w-[34px] rounded-full transition-colors"
                style={{ background: keep ? 'var(--fw-primary)' : 'var(--fw-surface-2)' }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                  style={{ left: keep ? '16px' : '2px' }}
                />
              </span>
              Keep me signed in
            </button>
          </div>

          <button type="submit" disabled={login.isPending} className="fw-btn-primary h-[46px] w-full text-[15px]">
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="text-center font-mono text-[11px] text-muted">Private · runs on your own hardware</div>
        </form>
      </div>
    </div>
  )
}
