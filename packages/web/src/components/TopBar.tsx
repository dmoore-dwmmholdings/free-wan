import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLogout, useMe } from '../lib/auth'
import { Logo } from './Logo'
import { Avatar } from './Avatar'
import { SearchIcon, ChevronLeftIcon } from './icons'

export type Crumb = { label: string; to?: string }

/** Avatar that opens a small menu: identity, change password, sign out. */
function UserMenu() {
  const { data: me } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative flex-none">
      <button onClick={() => setOpen((o) => !o)} className="block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Account menu">
        <Avatar name={me?.username} size={34} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-theme border border-line bg-surface p-1.5 shadow-2xl">
          <div className="px-2.5 py-2">
            <div className="fw-mono-label">Signed in</div>
            <div className="mt-0.5 truncate text-sm font-semibold text-ink">{me?.username}</div>
          </div>
          {/* Phones: the sidebar (Categories/Plugins/Admin) is hidden and the bottom bar is
              full, so these pages would otherwise be unreachable on mobile. */}
          <div className="my-1 h-px bg-line md:hidden" />
          <Link to="/categories" onClick={() => setOpen(false)} className="block rounded-theme-sm px-2.5 py-2 text-sm text-ink hover:bg-surface-2 md:hidden">
            Categories
          </Link>
          <Link to="/plugins" onClick={() => setOpen(false)} className="block rounded-theme-sm px-2.5 py-2 text-sm text-ink hover:bg-surface-2 md:hidden">
            Plugins
          </Link>
          {me?.role === 'admin' && (
            <Link to="/settings/repositories" onClick={() => setOpen(false)} className="block rounded-theme-sm px-2.5 py-2 text-sm text-ink hover:bg-surface-2 md:hidden">
              Admin
            </Link>
          )}
          <div className="my-1 h-px bg-line" />
          <Link
            to="/change-password"
            onClick={() => setOpen(false)}
            className="block rounded-theme-sm px-2.5 py-2 text-sm text-ink hover:bg-surface-2"
          >
            Change password
          </Link>
          <button
            onClick={async () => {
              setOpen(false)
              await logout.mutateAsync()
              navigate('/login', { replace: true })
            }}
            className="block w-full rounded-theme-sm px-2.5 py-2 text-left text-sm text-ink hover:bg-surface-2"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/** Library top bar: logo, global search, account. (Browse / Collections / Clips.) */
export function AppTopBar({
  search,
  right,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  right?: ReactNode
}) {
  return (
    <header className="flex h-[62px] flex-none items-center gap-4 border-b border-line bg-surface px-5">
      <Link to="/" className="flex-none">
        <Logo size={30} textSize={18} />
      </Link>
      {search && (
        <div className="flex h-[38px] w-full max-w-[480px] flex-1 items-center gap-2.5 rounded-theme-sm border border-line bg-bg px-3">
          <SearchIcon className="h-[15px] w-[15px] flex-none text-muted" />
          <input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? 'Search…'}
            className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
          />
        </div>
      )}
      <div className="flex-1" />
      {right}
      <UserMenu />
    </header>
  )
}

function CrumbWordmark() {
  return (
    <span>
      Free<span className="font-semibold text-ink">WAN</span>
    </span>
  )
}

/** Breadcrumb top bar for focused pages (Detail / Theater / Commands / Admin). */
export function BreadcrumbBar({
  back,
  home = false,
  trail,
  right,
}: {
  back?: string
  home?: boolean
  trail: Crumb[]
  right?: ReactNode
}) {
  const navigate = useNavigate()
  // Prefer going back through history so the library's filters (which live in the URL) are kept;
  // fall back to the breadcrumb's `back` path when this page was opened directly (no app history).
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(back ?? '/')
  }
  return (
    <header className="flex h-14 flex-none items-center gap-3.5 border-b border-line bg-surface px-5">
      {back && (
        <button
          onClick={goBack}
          aria-label="Back"
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-theme-sm border border-line text-ink hover:bg-surface-2"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
      )}
      {home && (
        <Link to="/" aria-label="Home" className="flex-none">
          {/* Honor an uploaded brand logo here too — the admin pages used to always show the
              built-in monogram regardless of branding. */}
          <Logo size={28} showWordmark={false} />
        </Link>
      )}
      <nav className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted">
        {home && (
          <>
            <Link to="/" className="hover:text-ink">
              <CrumbWordmark />
            </Link>
            {trail.length > 0 && <span className="opacity-50">›</span>}
          </>
        )}
        {trail.map((c, i) => {
          const last = i === trail.length - 1
          return (
            <span key={i} className="flex min-w-0 items-center gap-2">
              {c.to && !last ? (
                <Link to={c.to} className="truncate hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span className={last ? 'truncate text-ink' : 'truncate'}>{c.label}</span>
              )}
              {!last && <span className="opacity-50">›</span>}
            </span>
          )
        })}
      </nav>
      <div className="flex-1" />
      {right}
      <UserMenu />
    </header>
  )
}
