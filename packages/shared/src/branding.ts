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
  siteName: 'Free-WAN',
  logoUrl: null,
  faviconUrl: null,
  theme: 'midnight',
  mode: 'dark',
  colors: {
    primary: '#7c3aed',
    accent: '#22d3ee',
    background: '#0b0b10',
    surface: '#16161d',
    text: '#e7e7ea',
  },
  fonts: { heading: 'Inter', body: 'Inter', headingUrl: null, bodyUrl: null },
  radius: '0.75rem',
}

/** Named presets the editor can apply (FR-46). */
export const BRANDING_PRESETS: Record<string, Pick<Branding, 'mode' | 'colors' | 'radius'>> = {
  midnight: { mode: 'dark', radius: '0.75rem', colors: DEFAULT_BRANDING.colors },
  slate: {
    mode: 'dark',
    radius: '0.5rem',
    colors: { primary: '#3b82f6', accent: '#38bdf8', background: '#0f172a', surface: '#1e293b', text: '#e2e8f0' },
  },
  neon: {
    mode: 'dark',
    radius: '1rem',
    colors: { primary: '#ec4899', accent: '#a3e635', background: '#09090b', surface: '#18181b', text: '#fafafa' },
  },
  paper: {
    mode: 'light',
    radius: '0.5rem',
    colors: { primary: '#6d28d9', accent: '#0ea5e9', background: '#f8fafc', surface: '#ffffff', text: '#0f172a' },
  },
}

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
