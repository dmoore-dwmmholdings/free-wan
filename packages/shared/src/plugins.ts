import { z } from 'zod'

// ---------------------------------------------------------------------------
// Plugin parameter / config fields (reused for command params and admin config).
// Intentionally close to the command-param shape so the web can reuse one Field.
// ---------------------------------------------------------------------------

export const pluginFieldTypeSchema = z.enum(['string', 'number', 'boolean', 'enum'])
export type PluginFieldType = z.infer<typeof pluginFieldTypeSchema>

export const pluginFieldSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'identifier'),
  label: z.string().min(1).max(80),
  type: pluginFieldTypeSchema,
  required: z.boolean().optional(),
  default: z.string().nullable().optional(),
  options: z.array(z.string()).optional(), // for type: 'enum'
  help: z.string().max(280).optional(),
})
export type PluginField = z.infer<typeof pluginFieldSchema>

// ---------------------------------------------------------------------------
// Permissions — the surface a manifest must declare to call the matching Host API.
// ---------------------------------------------------------------------------

export const pluginPermissionSchema = z.enum([
  'media:read',
  'collections:write',
  'clips:write',
  'storage',
  'notify',
  'network',
])
export type PluginPermission = z.infer<typeof pluginPermissionSchema>

export const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  'media:read': 'Read the media library',
  'collections:write': 'Create and modify collections',
  'clips:write': 'Create clips',
  storage: 'Persist its own data',
  notify: 'Post notifications',
  network: 'Access the network',
}

// ---------------------------------------------------------------------------
// UI block kit — a declarative, recursive tree the web renders with native,
// design-token-styled components. Plugin code builds these via ctx.ui.*.
// ---------------------------------------------------------------------------

export type UiBlock =
  | { type: 'stack'; direction?: 'vertical' | 'horizontal'; gap?: number; wrap?: boolean; children: UiBlock[] }
  | { type: 'card'; title?: string; children: UiBlock[] }
  | { type: 'divider' }
  | { type: 'text'; text: string; variant?: 'heading' | 'subheading' | 'body' | 'muted' | 'mono' }
  | { type: 'badge'; text: string; tone?: BlockTone }
  | { type: 'stat'; label: string; value: string; hint?: string }
  | { type: 'notice'; text: string; title?: string; tone?: 'info' | 'success' | 'warn' | 'danger' }
  | { type: 'image'; url: string; alt?: string; height?: number; rounded?: boolean }
  | { type: 'mediaCard'; mediaItemId: string; title?: string; posterUrl?: string }
  | { type: 'progress'; value: number; label?: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string; external?: boolean }
  | { type: 'button'; text: string; action: string; value?: unknown; variant?: 'primary' | 'ghost'; disabled?: boolean }
  | { type: 'input'; name: string; label?: string; placeholder?: string; inputType?: 'text' | 'number' | 'password'; value?: string }
  | { type: 'textarea'; name: string; label?: string; placeholder?: string; value?: string; rows?: number }
  | { type: 'select'; name: string; label?: string; options: Array<{ label: string; value: string }>; value?: string }
  | { type: 'toggle'; name: string; label?: string; value?: boolean }

export type BlockTone = 'neutral' | 'primary' | 'accent' | 'success' | 'warn' | 'danger'

const blockToneSchema = z.enum(['neutral', 'primary', 'accent', 'success', 'warn', 'danger'])

// Recursive zod schema (z.lazy for the two container blocks).
export const uiBlockSchema: z.ZodType<UiBlock> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('stack'),
      direction: z.enum(['vertical', 'horizontal']).optional(),
      gap: z.number().optional(),
      wrap: z.boolean().optional(),
      children: z.array(uiBlockSchema),
    }),
    z.object({ type: z.literal('card'), title: z.string().optional(), children: z.array(uiBlockSchema) }),
    z.object({ type: z.literal('divider') }),
    z.object({
      type: z.literal('text'),
      text: z.string(),
      variant: z.enum(['heading', 'subheading', 'body', 'muted', 'mono']).optional(),
    }),
    z.object({ type: z.literal('badge'), text: z.string(), tone: blockToneSchema.optional() }),
    z.object({ type: z.literal('stat'), label: z.string(), value: z.string(), hint: z.string().optional() }),
    z.object({
      type: z.literal('notice'),
      text: z.string(),
      title: z.string().optional(),
      tone: z.enum(['info', 'success', 'warn', 'danger']).optional(),
    }),
    z.object({ type: z.literal('image'), url: z.string(), alt: z.string().optional(), height: z.number().optional(), rounded: z.boolean().optional() }),
    z.object({ type: z.literal('mediaCard'), mediaItemId: z.string(), title: z.string().optional(), posterUrl: z.string().optional() }),
    z.object({ type: z.literal('progress'), value: z.number(), label: z.string().optional() }),
    z.object({ type: z.literal('code'), text: z.string() }),
    z.object({ type: z.literal('link'), text: z.string(), href: z.string(), external: z.boolean().optional() }),
    z.object({
      type: z.literal('button'),
      text: z.string(),
      action: z.string(),
      value: z.unknown().optional(),
      variant: z.enum(['primary', 'ghost']).optional(),
      disabled: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('input'),
      name: z.string(),
      label: z.string().optional(),
      placeholder: z.string().optional(),
      inputType: z.enum(['text', 'number', 'password']).optional(),
      value: z.string().optional(),
    }),
    z.object({
      type: z.literal('textarea'),
      name: z.string(),
      label: z.string().optional(),
      placeholder: z.string().optional(),
      value: z.string().optional(),
      rows: z.number().optional(),
    }),
    z.object({
      type: z.literal('select'),
      name: z.string(),
      label: z.string().optional(),
      options: z.array(z.object({ label: z.string(), value: z.string() })),
      value: z.string().optional(),
    }),
    z.object({ type: z.literal('toggle'), name: z.string(), label: z.string().optional(), value: z.boolean().optional() }),
  ]) as z.ZodType<UiBlock>,
)

/** A panel render result: the root block (or a list, wrapped in a vertical stack by the host). */
export const uiViewSchema = z.union([uiBlockSchema, z.array(uiBlockSchema)])
export type UiView = z.infer<typeof uiViewSchema>

// ---------------------------------------------------------------------------
// Manifest (plugin.json) — the source of truth for a plugin's capabilities.
// ---------------------------------------------------------------------------

export const pluginCommandSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'identifier'),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  params: z.array(pluginFieldSchema).max(30).optional(),
  allowNonAdmin: z.boolean().optional(),
})
export type PluginCommandDef = z.infer<typeof pluginCommandSchema>

export const pluginPanelSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'identifier'),
  title: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  placement: z.enum(['plugin_page', 'detail_sidebar', 'dashboard']).default('plugin_page'),
  allowNonAdmin: z.boolean().optional(),
  /** When set, the web re-renders the panel on this interval (ms) for live progress. */
  refreshMs: z.number().int().min(250).max(120_000).optional(),
})
export type PluginPanelDef = z.infer<typeof pluginPanelSchema>

/** Catalog of domain events a plugin may subscribe to (the "automatically when…" triggers). */
export const PLUGIN_EVENTS = [
  'media.added',
  'media.updated',
  'media.removed',
  'scan.completed',
  'clip.created',
  'repository.added',
] as const
export const pluginEventNameSchema = z.enum(PLUGIN_EVENTS)
export type PluginEventName = z.infer<typeof pluginEventNameSchema>

export const pluginManifestSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/, 'id must be reverse-DNS-ish (letters, digits, . _ -)'),
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(40),
  description: z.string().max(2000).optional(),
  author: z.string().max(120).optional(),
  icon: z.string().max(20_000).optional(), // inline SVG, sanitized on install
  main: z.string().min(1).max(200),
  engine: z.string().max(40).optional(),
  daemon: z.boolean().default(false),
  permissions: z.array(pluginPermissionSchema).default([]),
  events: z.array(pluginEventNameSchema).default([]),
  env: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
  commands: z.array(pluginCommandSchema).max(50).default([]),
  ui: z.array(pluginPanelSchema).max(20).default([]),
  config: z.array(pluginFieldSchema).max(50).default([]),
})
export type PluginManifest = z.infer<typeof pluginManifestSchema>

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export const pluginStatusSchema = z.enum(['installed', 'active', 'error', 'disabled'])
export type PluginStatus = z.infer<typeof pluginStatusSchema>

/** User-facing view: only the panels/commands the caller may use. */
export const pluginDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  icon: z.string().nullable(),
  daemon: z.boolean(),
  enabled: z.boolean(),
  status: pluginStatusSchema,
  commands: z.array(pluginCommandSchema),
  panels: z.array(pluginPanelSchema),
})
export type PluginDto = z.infer<typeof pluginDtoSchema>

/** Admin view: the full manifest, declared permissions, config values, last error. */
export const adminPluginDtoSchema = pluginDtoSchema.extend({
  manifest: pluginManifestSchema,
  permissions: z.array(pluginPermissionSchema),
  events: z.array(pluginEventNameSchema),
  config: z.record(z.string(), z.unknown()),
  lastError: z.string().nullable(),
  installedAt: z.number(),
  updatedAt: z.number(),
})
export type AdminPluginDto = z.infer<typeof adminPluginDtoSchema>

export const pluginRunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'timeout'])
export type PluginRunStatus = z.infer<typeof pluginRunStatusSchema>

export const pluginRunDtoSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  kind: z.enum(['command', 'event', 'action', 'activate']),
  ref: z.string().nullable(),
  status: pluginRunStatusSchema,
  output: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
})
export type PluginRunDto = z.infer<typeof pluginRunDtoSchema>

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const installPluginRequestSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('path'), path: z.string().min(1) }),
  z.object({ source: z.literal('url'), url: z.string().url() }),
])
export type InstallPluginRequest = z.infer<typeof installPluginRequestSchema>

export const updatePluginRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })
export type UpdatePluginRequest = z.infer<typeof updatePluginRequestSchema>

export const runPluginCommandRequestSchema = z.object({
  args: z.record(z.string(), z.unknown()).default({}),
})
export type RunPluginCommandRequest = z.infer<typeof runPluginCommandRequestSchema>

export const pluginActionRequestSchema = z.object({
  action: z.string().min(1).max(120),
  value: z.unknown().optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
})
export type PluginActionRequest = z.infer<typeof pluginActionRequestSchema>
