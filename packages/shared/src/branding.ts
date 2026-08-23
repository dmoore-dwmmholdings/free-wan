import { z } from 'zod'

const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'must be a hex color')

export const brandingColorsSchema = z.object({
  primary: hex,
  accent: hex,
  background: hex,
  surface: hex,
  text: hex,
})
export type BrandingColors = z.infer<typeof brandingColorsSchema>

export const brandingFontsSchema = z.object({
  heading: z.string().min(1).max(60),
  body: z.string().min(1).max(60),
  headingUrl: z.string().nullable(),
  bodyUrl: z.string().nullable(),
})

export const brandingSchema = z.object({
  siteName: z.string().min(1).max(60),
  logoUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  theme: z.string().min(1).max(40),
  mode: z.enum(['light', 'dark', 'system']),
  colors: brandingColorsSchema,
  fonts: brandingFontsSchema,
  radius: z.string().max(12),
})
export type Branding = z.infer<typeof brandingSchema>

export const DEFAULT_BRANDING: Branding = {
  siteName: 'FreeWAN',
  logoUrl: null,
  faviconUrl: null,
  theme: 'midnight',
  mode: 'dark',
  colors: {
    // #6e4cff (not the design package's #7c5cff): the deepest violet that keeps white
    // button text at WCAG AA 4.5:1 — the original sat at 4.36:1.
    primary: '#6e4cff',
    accent: '#22d3ee',
    background: '#0b0b10',
    surface: '#16161d',
    text: '#e9e9ee',
  },
  fonts: { heading: 'Space Grotesk', body: 'Hanken Grotesk', headingUrl: null, bodyUrl: null },
  radius: '16px',
}

/**
 * Named presets the Branding studio can apply (FR-46). Each is a full retune — base colors,
 * corner radius, light/dark mode, and the display/body typefaces. Secondary tokens
 * (surface-2, border, muted, on-primary, radius-sm) are derived from these at runtime.
 */
export type BrandingPreset = Pick<Branding, 'mode' | 'colors' | 'radius'> & {
  fonts: { heading: string; body: string }
}

export const BRANDING_PRESETS: Record<string, BrandingPreset> = {
  midnight: {
    mode: 'dark',
    radius: '16px',
    colors: { primary: '#6e4cff', accent: '#22d3ee', background: '#0b0b10', surface: '#16161d', text: '#e9e9ee' },
    fonts: { heading: 'Space Grotesk', body: 'Hanken Grotesk' },
  },
  slate: {
    mode: 'dark',
    radius: '11px',
    colors: { primary: '#5b8def', accent: '#34d399', background: '#16181d', surface: '#1e2127', text: '#e3e6ea' },
    fonts: { heading: 'Space Grotesk', body: 'Hanken Grotesk' },
  },
  forest: {
    mode: 'dark',
    radius: '14px',
    colors: { primary: '#3fb873', accent: '#8fd6b4', background: '#0c1310', surface: '#121d17', text: '#e6efe8' },
    fonts: { heading: 'Space Grotesk', body: 'Hanken Grotesk' },
  },
  ember: {
    mode: 'dark',
    radius: '13px',
    colors: { primary: '#ff7a3c', accent: '#ffd24a', background: '#15100d', surface: '#1f1813', text: '#f6ece2' },
    fonts: { heading: 'Space Grotesk', body: 'Hanken Grotesk' },
  },
  neon: {
    mode: 'dark',
    radius: '6px',
    colors: { primary: '#ff2e88', accent: '#00f5d4', background: '#08080d', surface: '#12121c', text: '#f2f2ff' },
    fonts: { heading: 'Space Grotesk', body: 'Hanken Grotesk' },
  },
  paper: {
    mode: 'light',
    radius: '4px',
    colors: { primary: '#b8442b', accent: '#2f6f63', background: '#efece4', surface: '#ffffff', text: '#1b1a16' },
    fonts: { heading: 'Newsreader', body: 'Hanken Grotesk' },
  },
  linen: {
    mode: 'light',
    radius: '10px',
    colors: { primary: '#1f6f5c', accent: '#c2682f', background: '#f3efe6', surface: '#fbf8f2', text: '#241f18' },
    fonts: { heading: 'Space Grotesk', body: 'Hanken Grotesk' },
  },
}

/** Font families offered by the Branding studio (FR-47); all are self-hosted. */
export const BRANDING_HEADING_FONTS = ['Space Grotesk', 'Newsreader', 'Sora', 'Bricolage Grotesque', 'Instrument Serif'] as const
export const BRANDING_BODY_FONTS = ['Hanken Grotesk', 'IBM Plex Sans', 'Figtree'] as const

// PUT accepts the editable subset (asset URLs are managed by the upload route).
// colors/fonts are deep-partial so the editor can send just the field(s) that changed.
export const updateBrandingRequestSchema = z
  .object({
    siteName: z.string().min(1).max(60).optional(),
    theme: z.string().min(1).max(40).optional(),
    mode: z.enum(['light', 'dark', 'system']).optional(),
    colors: brandingColorsSchema.partial().optional(),
    fonts: brandingFontsSchema.partial().optional(),
    radius: z.string().max(12).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })
export type UpdateBrandingRequest = z.infer<typeof updateBrandingRequestSchema>
