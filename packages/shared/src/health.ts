import { z } from 'zod'

/** Standard error envelope returned by every API route (see AGENTS.md). */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiError = z.infer<typeof apiErrorSchema>

/** GET /api/health response. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>
