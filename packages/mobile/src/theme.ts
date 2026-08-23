import type { Branding } from '@free-wan/shared'
import { DEFAULT_BRANDING } from '@free-wan/shared'
import { derivePalette, parseRadius, type Palette } from '@/lib/palette'

/**
 * Mirrors the web app's --fw-* tokens (packages/web/src/index.css). React Native has no CSS
 * custom properties or color-mix(), so `src/lib/palette.ts` does that arithmetic and the
 * results land here.
 *
 * This object is deliberately mutable and deliberately a singleton. The alternative — a
 * context and a `useTheme()` hook — would mean editing every one of the ~300 `theme.` reads
 * across 19 files to make a cosmetic feature work. Mutation is sound here for one specific
 * reason: this package has no `StyleSheet.create` anywhere, so every style object is built
 * during render and reads whatever the token holds at that moment. `applyBranding` therefore
 * only has to be followed by a re-render of the root, which is what `useBranding` arranges.
 *
 * If StyleSheet.create is ever introduced, those styles will freeze at the values they were
 * created with and this stops working — reach for the context at that point.
 */
export const theme = {
  color: { ...derivePalette(DEFAULT_BRANDING.colors) } as Palette,
  radius: { ...parseRadius(DEFAULT_BRANDING.radius), full: 999 },
  space: (n: number) => n * 4,
  /** Shown on the login screen, so the app names the server it belongs to. */
  siteName: DEFAULT_BRANDING.siteName,
}

/** Retune every token from a branding payload. Callers must re-render the root afterwards. */
export function applyBranding(branding: Branding): void {
  Object.assign(theme.color, derivePalette(branding.colors))
  Object.assign(theme.radius, parseRadius(branding.radius))
  theme.siteName = branding.siteName
}
