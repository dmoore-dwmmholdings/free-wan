import { useEffect, useState } from 'react'
import type { Branding } from '@free-wan/shared'
import { api } from './api'
import { applyBranding } from '@/theme'
import { getServerUrl } from './session'

/**
 * Apply the server's branding to the app's tokens.
 *
 * Not a TanStack query: it runs above the QueryClientProvider so the whole tree, login screen
 * included, is already branded on first paint rather than repainting a moment later.
 * `/api/branding` is public for the same reason on the web.
 *
 * Returns a version number that changes once branding has been applied. The root renders with
 * it as a key, which is what makes the mutated tokens in `theme` take effect — see the note
 * there about why the tokens are a mutable singleton.
 */
export function useBranding(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Before a server is chosen there is nothing to ask, and the defaults are already right.
      if (!(await getServerUrl())) return
      try {
        const branding = await api.get<Branding>('/api/branding')
        if (cancelled) return
        applyBranding(branding)
        setVersion((v) => v + 1)
      } catch {
        // An unreachable or older server leaves the built-in palette in place. Branding is
        // decoration; failing to fetch it must not keep anyone out of their library.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return version
}
