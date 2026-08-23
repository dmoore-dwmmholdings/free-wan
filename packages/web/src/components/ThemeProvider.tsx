import { useEffect, type ReactNode } from 'react'
import { useBranding } from '../lib/branding'
import { applyBrandingVars } from '../lib/theme'

/**
 * Applies branding at runtime (FR-45–48): writes the base `--fw-*` design tokens to :root from
 * GET /api/branding. The secondary tokens derive from these in index.css, so the whole app —
 * cards, buttons, inputs, the player — retunes live. Also sets the title and swaps the favicon.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data } = useBranding()

  useEffect(() => {
    if (!data) return
    applyBrandingVars(document.documentElement, data)
    document.title = data.siteName
    const themeColor = document.querySelector<HTMLMetaElement>("meta[name='theme-color']")
    if (themeColor) themeColor.content = data.colors.background
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
