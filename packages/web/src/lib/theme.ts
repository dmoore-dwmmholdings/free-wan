import type { Branding, BrandingColors } from '@free-wan/shared'

/** Map a stored font-family name to a full CSS stack (with an appropriate generic fallback). */
const FONT_STACKS: Record<string, string> = {
  'Space Grotesk': "'Space Grotesk', sans-serif",
  'Hanken Grotesk': "'Hanken Grotesk', sans-serif",
  Sora: "'Sora', sans-serif",
  'Bricolage Grotesque': "'Bricolage Grotesque', sans-serif",
  Bricolage: "'Bricolage Grotesque', sans-serif",
  Figtree: "'Figtree', sans-serif",
  'IBM Plex Sans': "'IBM Plex Sans', sans-serif",
  Newsreader: "'Newsreader', serif",
  'Instrument Serif': "'Instrument Serif', serif",
  Instrument: "'Instrument Serif', serif",
}

export function fontStack(name: string, fallback = 'sans-serif'): string {
  return FONT_STACKS[name] ?? `'${name}', ${fallback}`
}

/** Perceived luminance (0–1) of a #rgb / #rrggbb color. */
function luminance(hex: string): number {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return 0
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Write the base `--fw-*` design tokens (the five colors, corner radius, the display/body
 * font stacks, and a luminance-derived on-primary) to an element. The secondary tokens
 * (surface-2, border, muted, radius-sm) derive from these in index.css.
 */
export function applyBrandingVars(
  root: HTMLElement,
  b: { colors: BrandingColors; radius: string; fonts: { heading: string; body: string }; mode?: Branding['mode'] },
) {
  const s = root.style
  s.setProperty('--fw-bg', b.colors.background)
  s.setProperty('--fw-surface', b.colors.surface)
  s.setProperty('--fw-primary', b.colors.primary)
  s.setProperty('--fw-accent', b.colors.accent)
  s.setProperty('--fw-text', b.colors.text)
  s.setProperty('--fw-radius', b.radius)
  s.setProperty('--fw-font-head', fontStack(b.fonts.heading))
  s.setProperty('--fw-font-body', fontStack(b.fonts.body))
  s.setProperty('--fw-on-primary', luminance(b.colors.primary) > 0.55 ? '#15120c' : '#ffffff')
  if (b.mode && b.mode !== 'system') root.style.colorScheme = b.mode
}
