import type { ReactNode } from 'react'
import { useBranding } from '../lib/branding'

/** Centered branded card used by the login and change-password screens. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { data: branding } = useBranding()
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-neutral-100">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 shadow-xl">
        <div className="mb-6 text-center">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.siteName} className="mx-auto h-10 w-auto" />
          ) : (
            <h1 className="text-2xl font-bold text-brand">{branding?.siteName ?? 'Free-WAN'}</h1>
          )}
          <p className="mt-1 text-sm text-neutral-400">{title}</p>
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
    <label className="mb-4 block">
      <span className="mb-1 block text-sm text-neutral-300">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-brand"
      />
    </label>
  )
}

export function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="mt-2 w-full rounded-lg bg-brand px-3 py-2 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{children}</p>
}
