import { z } from 'zod'

export const MAX_CLIP_SECONDS = 600

export const clipExportStatusSchema = z.enum(['none', 'queued', 'rendering', 'ready', 'failed'])
export type ClipExportStatus = z.infer<typeof clipExportStatusSchema>

export const clipDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceItemId: z.string().nullable(),
  startS: z.number(),
  endS: z.number(),
  durationS: z.number(),
  loop: z.boolean(),
  orphaned: z.boolean(),
  posterUrl: z.string().nullable(),
  previewUrl: z.string(),
  exportStatus: clipExportStatusSchema,
  exportUrl: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type ClipDto = z.infer<typeof clipDtoSchema>

const rangeRefine = (v: { startS?: number; endS?: number }) =>
  v.startS === undefined || v.endS === undefined || v.endS > v.startS
const rangeLenRefine = (v: { startS?: number; endS?: number }) =>
  v.startS === undefined || v.endS === undefined || v.endS - v.startS <= MAX_CLIP_SECONDS

export const createClipRequestSchema = z
  .object({
    sourceItemId: z.string(),
    name: z.string().trim().min(1).max(100),
    startS: z.number().nonnegative(),
    endS: z.number().positive(),
    loop: z.boolean().optional(),
  })
  .refine((v) => v.endS > v.startS, { message: 'endS must be greater than startS' })
  .refine((v) => v.endS - v.startS <= MAX_CLIP_SECONDS, { message: `clip exceeds ${MAX_CLIP_SECONDS}s` })
export type CreateClipRequest = z.infer<typeof createClipRequestSchema>

export const updateClipRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    startS: z.number().nonnegative().optional(),
    endS: z.number().positive().optional(),
    loop: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })
  .refine(rangeRefine, { message: 'endS must be greater than startS' })
  .refine(rangeLenRefine, { message: `clip exceeds ${MAX_CLIP_SECONDS}s` })
export type UpdateClipRequest = z.infer<typeof updateClipRequestSchema>

export const exportClipRequestSchema = z.object({ format: z.enum(['mp4', 'gif']) })
export type ExportClipRequest = z.infer<typeof exportClipRequestSchema>

export const clipPreviewSchema = z.object({
  sourceUrl: z.string(),
  startS: z.number(),
  endS: z.number(),
  loop: z.boolean(),
  orphaned: z.boolean(),
})
export type ClipPreview = z.infer<typeof clipPreviewSchema>
