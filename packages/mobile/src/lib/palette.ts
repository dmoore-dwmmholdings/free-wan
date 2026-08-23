import type { Branding } from '@free-wan/shared'

/**
 * The web app derives most of its palette from five base colours using CSS `color-mix`
 * (packages/web/src/index.css). React Native has no `color-mix`, so the same arithmetic is
 * done here — same formulas and same percentages, so a preset that retunes the web app
 * retunes this one to match rather than to something merely similar.
 */

interface Rgb {
  r: number
  g: number
  b: number
}

/** Parse `#rgb`, `#rrggbb`, or `rgb()/rgba()`. Returns null for anything else. */
export function parseColor(input: string): Rgb | null {
  const value = input.trim()

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1]!
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((d) => d + d)
            .join('')
        : digits
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    }
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value)
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    if ([r, g, b].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return { r, g, b }
  }

  return null
}

function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/**
 * `color-mix(in srgb, a <weight>%, b)` — `weight` of `a` against the remainder of `b`.
 * Falls back to `a` unparsed rather than throwing: a bad colour from the branding API should
 * cost that one token, not the whole app's chrome.
 */
export function mix(a: string, b: string, weightOfA: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return a
  const w = Math.min(1, Math.max(0, weightOfA))
  return toHex({
    r: ca.r * w + cb.r * (1 - w),
    g: ca.g * w + cb.g * (1 - w),
    b: ca.b * w + cb.b * (1 - w),
  })
}

/** `color-mix(in srgb, color <alpha>%, transparent)` — the same colour, partly see-through. */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color)
  if (!c) return color
  const a = Math.min(1, Math.max(0, alpha))
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`
}

/**
 * Whether a colour is light enough to need dark text over it. Uses the sRGB relative
 * luminance the WCAG contrast formula is built on, not a plain average — a saturated yellow
 * and a saturated blue of the same average are nowhere near equally light.
 */
/**
 * The luminance at which black text and white text are equally readable on a background:
 * where 1.05 / (L + 0.05) meets (L + 0.05) / 0.05, which is sqrt(1.05 x 0.05) - 0.05.
 *
 * The threshold used to be 0.5, which is the midpoint of the scale rather than the midpoint of
 * legibility, and the two are nowhere near each other. A mid-grey sits at 0.216: black text on
 * it reaches 5.3:1 where white manages 3.9:1, so it wants dark chrome, and 0.5 gave it light.
 * Every preset that ships is far enough from the crossover to be unaffected either way — but
 * an admin picks these colours, and nothing stops them picking one from the middle.
 */
const TEXT_CROSSOVER_LUMINANCE = 0.1791

export function isLight(color: string): boolean {
  const c = parseColor(color)
  if (!c) return false
  const channel = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  // Weighted the way the eye is: green carries most of the sense of brightness and blue
  // almost none, so #00ff00 reads as a light background and #0000ff as a dark one, though a
  // plain average of the channels would call them identical.
  const luminance = 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
  return luminance > TEXT_CROSSOVER_LUMINANCE
}

export interface Palette {
  bg: string
  surface: string
  surface2: string
  border: string
  primary: string
  primaryTint: string
  accent: string
  text: string
  muted: string
  onPrimary: string
  danger: string
}

/** Resolve a branding payload's five base colours into the full token set. */
export function derivePalette(colors: Branding['colors']): Palette {
  const { background: bg, surface, primary, accent, text } = colors
  return {
    bg,
    surface,
    // --fw-surface-2: color-mix(in srgb, surface, text 6%)
    surface2: mix(text, surface, 0.06),
    // --fw-border: color-mix(in srgb, text 11%, transparent)
    border: withAlpha(text, 0.11),
    primary,
    // --fw-primary-tint: color-mix(in srgb, primary 15%, transparent)
    primaryTint: withAlpha(primary, 0.15),
    accent,
    text,
    // --fw-muted: 62% text against the background. The web comment records why it is 62% and
    // not 52%: it is what holds muted text at WCAG AA on both bg and surface.
    muted: mix(text, bg, 0.62),
    // Fixed in the web tokens too — every preset's primary is dark enough for white on it.
    onPrimary: '#ffffff',
    danger: '#f87171',
  }
}

/**
 * The web app sets one radius and derives the small one as `radius * 0.58`. Branding sends it
 * as a CSS length, which React Native cannot use.
 */
export function parseRadius(value: string): { sm: number; md: number } {
  const n = Number.parseFloat(value)
  const md = Number.isFinite(n) && n >= 0 ? n : 16
  return { sm: Math.round(md * 0.58), md }
}
