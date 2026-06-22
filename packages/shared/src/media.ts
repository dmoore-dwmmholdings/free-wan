import { z } from 'zod'

export const repositoryTypeSchema = z.enum(['video', 'image', 'mixed'])
export type RepositoryType = z.infer<typeof repositoryTypeSchema>

export const repositoryStatusSchema = z.enum([
  'unknown',
  'online',
  'offline',
  'scanning',
  'error',
])
export type RepositoryStatus = z.infer<typeof repositoryStatusSchema>

export const repositoryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  type: repositoryTypeSchema,
  enabled: z.boolean(),
  readOnly: z.boolean(),
  status: repositoryStatusSchema,
  lastScanAt: z.number().nullable(),
  lastError: z.string().nullable(),
  itemCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type RepositoryDto = z.infer<typeof repositoryDtoSchema>

export const createRepositoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  rootPath: z.string().min(1),
  type: repositoryTypeSchema,
  readOnly: z.boolean().optional(),
})
export type CreateRepositoryRequest = z.infer<typeof createRepositoryRequestSchema>

export const updateRepositoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    type: repositoryTypeSchema.optional(),
    readOnly: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })
export type UpdateRepositoryRequest = z.infer<typeof updateRepositoryRequestSchema>

export const scanRequestSchema = z.object({ full: z.boolean().optional() })
export type ScanRequest = z.infer<typeof scanRequestSchema>

export const scanStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  progress: z.number(),
  found: z.number().optional(),
  indexed: z.number().optional(),
  failed: z.number().optional(),
  removed: z.number().optional(),
})
export type ScanStatus = z.infer<typeof scanStatusSchema>

// ---- Discovery (Phase 3) --------------------------------------------------

export const mediaTypeSchema = z.enum(['video', 'image'])
export type MediaType = z.infer<typeof mediaTypeSchema>

export const mediaCardSchema = z.object({
  id: z.string(),
  type: mediaTypeSchema,
  title: z.string(),
  durationS: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  posterUrl: z.string(),
  repositoryId: z.string(),
  categoryPath: z.string().nullable(),
  liked: z.boolean(),
  likeCount: z.number(),
})
export type MediaCard = z.infer<typeof mediaCardSchema>

export const mediaListResponseSchema = z.object({
  data: z.array(mediaCardSchema),
  nextCursor: z.string().nullable(),
  total: z.number(),
})
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>

export const mediaSortSchema = z.enum(['title', 'added', 'created', 'duration', 'popularity'])
export type MediaSort = z.infer<typeof mediaSortSchema>

export const mediaQuerySchema = z.object({
  q: z.string().optional(),
  type: mediaTypeSchema.optional(),
  repository: z.string().optional(),
  /** Filter by the *repository's* type (one or many) — powers the Photos/Video tabs. */
  repositoryType: z.union([repositoryTypeSchema, z.array(repositoryTypeSchema)]).optional(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  collection: z.string().optional(),
  liked: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  minHeight: z.coerce.number().int().nonnegative().optional(),
  minDuration: z.coerce.number().nonnegative().optional(),
  maxDuration: z.coerce.number().nonnegative().optional(),
  sort: mediaSortSchema.default('added'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})
export type MediaQuery = z.infer<typeof mediaQuerySchema>

export const categoryChainNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
})
export const subtitleDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['embedded', 'sidecar']),
  language: z.string().nullable(),
  label: z.string().nullable(),
  format: z.string().nullable(),
})
export const mediaDetailSchema = mediaCardSchema.extend({
  ext: z.string(),
  sizeBytes: z.number(),
  frameRate: z.number().nullable(),
  bitrate: z.number().nullable(),
  container: z.string().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  audioTracks: z.number(),
  playbackMode: z.enum(['direct', 'hls']).nullable(),
  capturedAt: z.number().nullable(),
  addedAt: z.number(),
  relPath: z.string(),
  categories: z.array(categoryChainNodeSchema),
  subtitles: z.array(subtitleDtoSchema),
})
export type MediaDetail = z.infer<typeof mediaDetailSchema>

export const categoryNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  depth: z.number(),
  itemCount: z.number(),
  hasChildren: z.boolean(),
})
export type CategoryNodeDto = z.infer<typeof categoryNodeSchema>

// ---- Playback (Phase 4) ---------------------------------------------------

export const captionTrackSchema = z.object({
  id: z.string(),
  label: z.string(),
  language: z.string().nullable(),
  url: z.string(),
  default: z.boolean(),
})
export type CaptionTrack = z.infer<typeof captionTrackSchema>

export const playbackDescriptorSchema = z.object({
  mode: z.enum(['direct', 'hls']),
  url: z.string(),
  captions: z.array(captionTrackSchema),
  resumeAt: z.number().nullable(),
  duration: z.number().nullable(),
})
export type PlaybackDescriptor = z.infer<typeof playbackDescriptorSchema>

export const progressRequestSchema = z.object({
  positionS: z.number().nonnegative(),
  durationS: z.number().positive().optional(),
})
export type ProgressRequest = z.infer<typeof progressRequestSchema>

// ---- Likes & collections (Phase 5) ----------------------------------------

export const likeResponseSchema = z.object({
  liked: z.boolean(),
  likeCount: z.number(),
})
export type LikeResponse = z.infer<typeof likeResponseSchema>

export const collectionDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  coverItemId: z.string().nullable(),
  coverUrl: z.string().nullable(),
  itemCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type CollectionDto = z.infer<typeof collectionDtoSchema>

export const createCollectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
})
export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>

export const updateCollectionRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(2000).nullable().optional(),
    coverItemId: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })
export type UpdateCollectionRequest = z.infer<typeof updateCollectionRequestSchema>

export const addCollectionItemRequestSchema = z.object({
  mediaItemId: z.string(),
  position: z.number().int().nonnegative().optional(),
})
export type AddCollectionItemRequest = z.infer<typeof addCollectionItemRequestSchema>

export const reorderCollectionRequestSchema = z.object({
  order: z.array(z.string()).min(1),
})
export type ReorderCollectionRequest = z.infer<typeof reorderCollectionRequestSchema>
