import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/settings/repositories', label: 'Repositories' },
  { to: '/settings/commands', label: 'Commands' },
  { to: '/settings/plugins', label: 'Plugins' },
  { to: '/settings/branding', label: 'Branding' },
  { to: '/settings/system', label: 'System' },
]

/** Sub-navigation shared by the admin pages (which use the focused PageShell, not the SideNav).
 *  Without it the Branding and System pages are only reachable by typing the URL. */
export function AdminTabs() {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) => `fw-chip ${isActive ? 'fw-chip-active' : 'hover:border-muted'}`}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
