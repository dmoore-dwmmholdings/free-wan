import { useEffect, type ReactNode } from 'react'
import { useBranding } from '../lib/branding'

/**
 * Applies branding at runtime (FR-48): writes the primary color to the `--brand-color`
 * CSS variable that the Tailwind theme reads, sets the document title, and swaps the
 * favicon — no rebuild. Components using `text-brand`/`bg-brand`/`border-brand` retheme live.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data } = useBranding()

  useEffect(() => {
    if (!data) return
    const root = document.documentElement
    root.style.setProperty('--brand-color', data.colors.primary)
    root.style.setProperty('--brand-accent', data.colors.accent)
    document.title = data.siteName
    if (data.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = data.faviconUrl
    }
  }, [data])

  return <>{children}</>
}
