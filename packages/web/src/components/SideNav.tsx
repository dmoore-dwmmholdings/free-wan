import { type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useMe } from '../lib/auth'
import { useRepositories } from '../lib/repositories'
import { HeartIcon, GridIcon, ListIcon, CollectionsIcon, ClipsIcon, TerminalIcon, AdminIcon, PluginIcon } from './icons'

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function NavItem({ to, icon, label, active }: { to: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      style={active ? { boxShadow: 'inset 3px 0 0 var(--fw-primary)' } : undefined}
      className={`flex items-center gap-3 rounded-theme-sm px-3 py-2.5 text-[13.5px] transition ${
        active ? 'bg-surface-2 font-semibold text-ink' : 'font-medium text-muted hover:bg-surface-2 hover:text-ink'
      }`}
    >
      <span className="flex h-[15px] w-[15px] flex-none items-center justify-center">{icon}</span>
      {label}
    </Link>
  )
}

/** Live repository status — admin-only (the listing endpoint requires admin). */
function RepoFooter() {
  const { data } = useRepositories()
  const repos = data?.data ?? []
  if (repos.length === 0) return null
  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3.5 font-mono text-[10.5px] text-muted">
      <div className="tracking-[0.14em]">REPOSITORIES</div>
      {repos.map((r) => {
        const online = r.enabled && (r.status === 'online' || r.status === 'scanning')
        return (
          <div key={r.id} className={`flex items-center gap-2 ${online ? '' : 'opacity-60'}`}>
            <span
              className="h-[7px] w-[7px] flex-none rounded-full"
              style={
                online
                  ? { background: 'var(--fw-accent)' }
                  : { border: '1.5px solid var(--fw-muted)' }
              }
            />
            <span className="truncate">
              {r.name} · {online ? formatCount(r.itemCount) : 'offline'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Left navigation hub for the library (desktop). */
export function SideNav() {
  const { data: me } = useMe()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const liked = params.get('liked') === 'true'
  const hasCategory = !!params.get('category')
  const onBrowse = pathname === '/'

  return (
    <aside className="sticky top-[62px] hidden h-[calc(100vh-62px)] w-[230px] flex-none flex-col gap-1 overflow-y-auto border-r border-line bg-surface px-3.5 py-4 md:flex">
      <div className="fw-mono-label px-2.5 pb-1.5 pt-1">Library</div>
      <NavItem to="/" icon={<GridIcon />} label="Browse" active={onBrowse && !hasCategory && !liked} />
      <NavItem to="/categories" icon={<ListIcon />} label="Categories" active={pathname.startsWith('/categories')} />
      <NavItem to="/?liked=true" icon={<HeartIcon className="h-[15px] w-[15px]" />} label="Liked" active={onBrowse && liked} />
      <NavItem to="/collections" icon={<CollectionsIcon />} label="Collections" active={pathname.startsWith('/collections')} />
      <NavItem to="/clips" icon={<ClipsIcon />} label="Clips" active={pathname.startsWith('/clips')} />

      <div className="fw-mono-label px-2.5 pb-1.5 pt-3">Manage</div>
      <NavItem to="/commands" icon={<TerminalIcon />} label="Commands" active={pathname.startsWith('/commands') || pathname.startsWith('/runs')} />
      <NavItem to="/plugins" icon={<PluginIcon className="h-[15px] w-[15px]" />} label="Plugins" active={pathname.startsWith('/plugins')} />
      {me?.role === 'admin' && (
        <NavItem to="/settings/repositories" icon={<AdminIcon />} label="Admin" active={pathname.startsWith('/settings')} />
      )}

      {me?.role === 'admin' && <RepoFooter />}
    </aside>
  )
}

const TABS = [
  { to: '/', label: 'Browse', icon: <GridIcon className="h-[17px] w-[17px]" />, match: (p: string, liked: boolean) => p === '/' && !liked },
  { to: '/?liked=true', label: 'Liked', icon: <HeartIcon className="h-[17px] w-[17px]" />, match: (p: string, liked: boolean) => p === '/' && liked },
  { to: '/collections', label: 'Collections', icon: <CollectionsIcon className="h-[17px] w-[17px]" />, match: (p: string) => p.startsWith('/collections') },
  { to: '/clips', label: 'Clips', icon: <ClipsIcon className="h-[17px] w-[17px]" />, match: (p: string) => p.startsWith('/clips') },
  { to: '/commands', label: 'Commands', icon: <TerminalIcon className="h-[17px] w-[17px]" />, match: (p: string) => p.startsWith('/commands') },
]

/** Bottom tab bar for the library on phones. */
export function BottomTabBar() {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const liked = params.get('liked') === 'true'
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex items-start justify-around border-t border-line bg-surface px-2 pt-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      {TABS.map((t) => {
        const active = t.match(pathname, liked)
        return (
          <Link key={t.label} to={t.to} className={`flex flex-col items-center gap-1 pb-2 ${active ? 'text-primary' : 'text-muted'}`}>
            {t.icon}
            <span className={`text-[9.5px] ${active ? 'font-semibold' : ''}`}>{t.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
