import { type ReactNode } from 'react'
import { AppTopBar, BreadcrumbBar, type Crumb } from './TopBar'
import { SideNav, BottomTabBar } from './SideNav'

/**
 * Library shell — global top bar + left navigation hub + content. Used by the library list
 * pages (Browse, Collections, Clips). The page scrolls in the document so window-rooted
 * infinite-scroll observers keep working; the sidebar is sticky beside it.
 */
export function LibraryLayout({
  search,
  headerRight,
  children,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  headerRight?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="sticky top-0 z-30">
        <AppTopBar search={search} right={headerRight} />
      </div>
      <div className="flex">
        <SideNav />
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      </div>
      <BottomTabBar />
    </div>
  )
}

/**
 * Focused page shell — a breadcrumb top bar over full-width content. Used by Detail, Theater,
 * Commands, the Branding studio, and the admin pages. The page supplies its own inner padding
 * and max-width.
 */
export function PageShell({
  back,
  home = false,
  trail,
  headerRight,
  children,
}: {
  back?: string
  home?: boolean
  trail: Crumb[]
  headerRight?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="sticky top-0 z-30">
        <BreadcrumbBar back={back} home={home} trail={trail} right={headerRight} />
      </div>
      <main className="min-w-0">{children}</main>
    </div>
  )
}
