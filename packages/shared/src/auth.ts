import { z } from 'zod'

export const roleSchema = z.enum(['admin', 'user'])
export type Role = z.infer<typeof roleSchema>

/** Input rules reused by create-user and (admin) password reset. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'letters, digits, dot, dash, underscore only')
export const passwordSchema = z.string().min(8).max(200)

/** Compact identity returned by /api/auth/login and /api/auth/me. */
export const meSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: roleSchema,
  canRunCommands: z.boolean(),
  mustChangePassword: z.boolean(),
})
export type Me = z.infer<typeof meSchema>

/** Full user record for the admin users table (never includes the hash). */
export const userDtoSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: roleSchema,
  canRunCommands: z.boolean(),
  disabled: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type UserDto = z.infer<typeof userDtoSchema>

// ---- request bodies -------------------------------------------------------

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

export const loginResponseSchema = z.object({ user: meSchema })
export type LoginResponse = z.infer<typeof loginResponseSchema>

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
})
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>

export const createUserRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: roleSchema,
  canRunCommands: z.boolean().optional(),
})
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>

export const updateUserRequestSchema = z
  .object({
    role: roleSchema.optional(),
    disabled: z.boolean().optional(),
    canRunCommands: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>

export const adminResetPasswordRequestSchema = z.object({
  newPassword: passwordSchema,
})
export type AdminResetPasswordRequest = z.infer<typeof adminResetPasswordRequestSchema>
