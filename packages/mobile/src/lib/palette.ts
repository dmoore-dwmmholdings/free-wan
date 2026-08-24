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
  /** 0..1. Opaque unless the colour was written with an alpha channel. */
  a: number
}

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, or `rgb()/rgba()`. Null for anything else.
 *
 * The four-digit and eight-digit forms are here because the branding schema accepts them —
 * `packages/shared/src/branding.ts` allows 3, 6 or 8 hex digits for every one of the five base
 * colours — and this file did not. The web app was fine, since CSS `color-mix` understands
 * them; the phone was not, and the way it failed was not subtle. `mix` returns its first
 * argument when it cannot parse, so a text colour written as `#241f18ff` made `surface-2`,
 * `border` and `muted` all come out as the text colour itself: near-black tile backdrops,
 * solid borders where an eleven-percent wash belongs, and muted text at full strength. On top
 * of that `isLight` answered false for a cream background, which points the status bar and the
 * keyboard at a dark scheme over a light app — the exact half-applied look `syncColorScheme`
 * exists to prevent. Nothing warned; the server had accepted the colour.
 */
export function parseColor(input: string): Rgb | null {
  const value = input.trim()

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)
  if (hex) {
    const digits = hex[1]!
    if (digits.length !== 3 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8) {
      return null
    }
    // The short forms double each digit: #abc is #aabbcc, #abcd is #aabbccdd.
    const full =
      digits.length <= 4
        ? digits
            .split('')
            .map((d) => d + d)
            .join('')
        : digits
    const at = (i: number) => parseInt(full.slice(i, i + 2), 16)
    return {
      r: at(0),
      g: at(2),
      b: at(4),
      a: full.length === 8 ? at(6) / 255 : 1,
    }
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/i.exec(value)
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    if (![r, g, b].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return null
    const raw = rgb[4] === undefined ? 1 : Number(rgb[4])
    const a = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1
    return { r, g, b, a }
  }

  return null
}

/** Back to something React Native takes: hex while opaque, `rgba()` once it is not. */
function toColor({ r, g, b, a }: Rgb): string {
  const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n)))
  if (a >= 1) {
    const part = (n: number) => byte(n).toString(16).padStart(2, '0')
    return `#${part(r)}${part(g)}${part(b)}`
  }
  return `rgba(${byte(r)},${byte(g)},${byte(b)},${Math.round(a * 1000) / 1000})`
}

/**
 * `color-mix(in srgb, a <weight>%, b)` — `weight` of `a` against the remainder of `b`.
 * Falls back to `a` unparsed rather than throwing: a bad colour from the branding API should
 * cost that one token, not the whole app's chrome.
 *
 * Mixed with the channels premultiplied by alpha, which is what `color-mix` does by default,
 * so a translucent input does not drag the result towards a colour it is barely contributing.
 * With two opaque colours — every preset that ships — this is the plain weighted average it
 * always was.
 */
export function mix(a: string, b: string, weightOfA: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return a
  const w = Math.min(1, Math.max(0, weightOfA))
  const alpha = ca.a * w + cb.a * (1 - w)
  if (alpha === 0) return 'rgba(0,0,0,0)'
  const channel = (ka: number, kb: number) => (ka * ca.a * w + kb * cb.a * (1 - w)) / alpha
  return toColor({
    r: channel(ca.r, cb.r),
    g: channel(ca.g, cb.g),
    b: channel(ca.b, cb.b),
    a: alpha,
  })
}

/**
 * `color-mix(in srgb, color <alpha>%, transparent)` — the same colour, partly see-through.
 * A colour that is already translucent gets more so, rather than being reset to this alpha.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color)
  if (!c) return color
  const a = Math.min(1, Math.max(0, alpha)) * c.a
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.round(a * 1000) / 1000})`
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

/** The dark half of the on-primary pair, shared with the web app's `--fw-on-primary`. */
const ON_PRIMARY_DARK = '#15120c'

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
    // --fw-muted: 65% text against the background — the share that holds muted text at WCAG AA
    // on both bg and surface, for every preset. It was 62%, chosen for that same reason and
    // wrong about it: `linen` landed at 4.41:1 against its background, under the 4.5:1 that
    // normal text needs. Kept in step with the web token by hand; the point of this file is
    // that a preset resolves to the same values in both apps, not merely similar ones.
    muted: mix(text, bg, 0.65),
    // Decided, not fixed. This used to be `#ffffff` with a comment saying the web tokens fixed
    // it too, which was simply untrue — the web app has always derived it — and the claim went
    // unchecked because five of the seven presets happen to want white anyway. `forest` and
    // `ember` do not: white on their primary is 2.53:1 and 2.59:1, under even the 3:1 that
    // large text needs, and those tokens are the label on the Sign in button, the Change
    // password button and the upload button. The web app put dark text on both.
    //
    // `isLight` rather than the web's old rule, because that rule was wrong in the other
    // direction too: it thresholds a plain channel average at 0.55, and called `slate` and
    // `neon` white at 3.23:1 and 3.50:1 where dark gives 5.79:1 and 5.34:1. The crossover
    // luminance below is right for all seven, and the web app now uses the same one — the
    // point of this file is that a preset resolves to the same values in both apps.
    onPrimary: isLight(primary) ? ON_PRIMARY_DARK : '#ffffff',
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
