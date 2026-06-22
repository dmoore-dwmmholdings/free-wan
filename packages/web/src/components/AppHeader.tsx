import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useLogout, useMe } from '../lib/auth'
import { useBranding } from '../lib/branding'

function navClass({ isActive }: { isActive: boolean }) {
  return `hidden text-sm sm:inline ${isActive ? 'text-brand' : 'text-neutral-400 hover:text-neutral-100'}`
}

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { data: me } = useMe()
  const { data: branding } = useBranding()
  const logout = useLogout()
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-neutral-800 bg-neutral-950/90 px-6 py-3 backdrop-blur">
      <Link to="/" className="flex items-center gap-2 text-lg font-bold text-brand">
        {branding?.logoUrl ? (
          <img src={branding.logoUrl} alt={branding.siteName} className="h-7 w-auto" />
        ) : (
          (branding?.siteName ?? 'Free-WAN')
        )}
      </Link>
      <nav className="flex items-center gap-3">
        <NavLink to="/" end className={navClass}>
          Library
        </NavLink>
        <NavLink to="/?liked=true" className={navClass}>
          Liked
        </NavLink>
        <NavLink to="/collections" className={navClass}>
          Collections
        </NavLink>
        <NavLink to="/clips" className={navClass}>
          Clips
        </NavLink>
        <NavLink to="/commands" className={navClass}>
          Commands
        </NavLink>
        {me?.role === 'admin' && (
          <>
            <NavLink to="/settings/repositories" className={navClass}>
              Repositories
            </NavLink>
            <NavLink to="/settings/branding" className={navClass}>
              Branding
            </NavLink>
            <NavLink to="/settings/system" className={navClass}>
              System
            </NavLink>
          </>
        )}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex items-center gap-3 text-sm text-neutral-400">
        <span className="hidden sm:inline">{me?.username}</span>
        <button
          onClick={async () => {
            await logout.mutateAsync()
            navigate('/login', { replace: true })
          }}
          className="text-neutral-300 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
