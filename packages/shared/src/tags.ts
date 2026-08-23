import { z } from 'zod'

/** A user-defined tag: a label that can be attached to any media item. */
export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
})
export type Tag = z.infer<typeof tagSchema>

/** A tag plus how many items carry it (for the tag list / filter bar). */
export const tagWithCountSchema = tagSchema.extend({ itemCount: z.number() })
export type TagWithCount = z.infer<typeof tagWithCountSchema>

const HEX = /^#[0-9a-fA-F]{6}$/

export const createTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(HEX).nullable().optional(),
})
export type CreateTagRequest = z.infer<typeof createTagRequestSchema>

export const updateTagRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: z.string().regex(HEX).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })
export type UpdateTagRequest = z.infer<typeof updateTagRequestSchema>

/** Attach a tag to a media item by id, or by name (the tag is created on the fly if new). */
export const addMediaTagRequestSchema = z
  .object({
    tagId: z.string().optional(),
    name: z.string().trim().min(1).max(40).optional(),
    color: z.string().regex(HEX).nullable().optional(),
  })
  .refine((v) => !!v.tagId || !!v.name, { message: 'tagId or name required' })
export type AddMediaTagRequest = z.infer<typeof addMediaTagRequestSchema>
