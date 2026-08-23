import type { ReactNode } from 'react'
import { Logo } from './Logo'

/** Centered branded card used by the change-password screen. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-ink">
      <div className="fw-card w-full max-w-sm p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-2.5">
          <Logo size={40} textSize={24} />
          <p className="text-sm text-muted">{title}</p>
        </div>
        {children}
      </div>
    </main>
  )
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-4 flex flex-col gap-2">
      <span className="fw-mono-label">{label}</span>
      <input {...props} className="fw-input" />
    </label>
  )
}

export function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" disabled={disabled} className="fw-btn-primary mt-2 h-11 w-full">
      {children}
    </button>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className="mb-3 rounded-theme-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{children}</p>
}
