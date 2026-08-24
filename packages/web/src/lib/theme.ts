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

/**
 * WCAG relative luminance (0–1) of a #rgb / #rrggbb / #rrggbbaa color.
 *
 * This used to average the raw channels and compare against 0.55, which is a threshold on the
 * wrong scale: sRGB values are gamma-encoded, and the contrast formula is defined on the
 * linearised ones. It cost real legibility on the primary button — `slate` and `neon` were
 * given white text at 3.23:1 and 3.50:1, where the dark half of the pair reaches 5.79:1 and
 * 5.34:1. Every preset now lands at 5.07:1 or better.
 */
function luminance(hex: string): number {
  let h = hex.replace('#', '')
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  const channel = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16)
    if (Number.isNaN(v)) return NaN
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [channel(0), channel(2), channel(4)]
  if ([r, g, b].some((n) => Number.isNaN(n))) return 0
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Where black text and white text are equally readable: sqrt(1.05 x 0.05) - 0.05. Kept in step
 * with `TEXT_CROSSOVER_LUMINANCE` in packages/mobile/src/lib/palette.ts, so a preset picks the
 * same on-primary in both apps.
 */
const TEXT_CROSSOVER_LUMINANCE = 0.1791

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
  s.setProperty(
    '--fw-on-primary',
    luminance(b.colors.primary) > TEXT_CROSSOVER_LUMINANCE ? '#15120c' : '#ffffff',
  )
  if (b.mode && b.mode !== 'system') root.style.colorScheme = b.mode
}
