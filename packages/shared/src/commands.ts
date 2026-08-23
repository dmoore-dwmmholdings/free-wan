import { z } from 'zod'

// arg_template token: a literal string, or a parameter reference with optional
// prefix/suffix (concatenated to the single argv entry) or a boolean whenTrue flag list.
export const argTokenSchema = z.union([
  z.string(),
  z.object({
    param: z.string(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    whenTrue: z.array(z.string()).optional(),
  }),
])
export type ArgToken = z.infer<typeof argTokenSchema>
export const argTemplateSchema = z.array(argTokenSchema)

export const commandParamTypeSchema = z.enum(['string', 'number', 'boolean', 'enum', 'repo_path'])
export type CommandParamType = z.infer<typeof commandParamTypeSchema>

export const commandParamConstraintsSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  options: z.array(z.string()).optional(),
  repoId: z.string().optional(),
  mustBeDir: z.boolean().optional(),
})
export type CommandParamConstraints = z.infer<typeof commandParamConstraintsSchema>

export const commandParamInputSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'identifier'),
  label: z.string().min(1).max(80),
  type: commandParamTypeSchema,
  required: z.boolean().optional(),
  default: z.string().nullable().optional(),
  constraints: commandParamConstraintsSchema.optional(),
})
export type CommandParamInput = z.infer<typeof commandParamInputSchema>

export const commandParamDtoSchema = commandParamInputSchema.extend({ id: z.string(), position: z.number() })
export type CommandParamDto = z.infer<typeof commandParamDtoSchema>

export const createCommandRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
  executable: z.string().min(1),
  argTemplate: argTemplateSchema,
  workingDir: z.string().nullable().optional(),
  timeoutS: z.number().int().positive().max(86_400).optional(),
  maxOutputKb: z.number().int().positive().max(65_536).optional(),
  maxConcurrent: z.number().int().positive().max(16).optional(),
  envAllowlist: z.array(z.string()).optional(),
  allowNonAdmin: z.boolean().optional(),
  enabled: z.boolean().optional(),
  params: z.array(commandParamInputSchema).max(50),
})
export type CreateCommandRequest = z.infer<typeof createCommandRequestSchema>

export const updateCommandRequestSchema = createCommandRequestSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'no fields to update' },
)
export type UpdateCommandRequest = z.infer<typeof updateCommandRequestSchema>

export const commandDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  allowNonAdmin: z.boolean(),
  enabled: z.boolean(),
  isInternal: z.boolean(),
  params: z.array(commandParamDtoSchema),
})
export type CommandDto = z.infer<typeof commandDtoSchema>

/** Admin-only view of a command: the full definition (executable, template, limits) the editor
 *  needs to pre-fill an edit form. Not exposed on the user-facing /api/commands listing. */
export const adminCommandDtoSchema = commandDtoSchema.extend({
  executable: z.string(),
  argTemplate: argTemplateSchema,
  workingDir: z.string().nullable(),
  timeoutS: z.number(),
  maxOutputKb: z.number(),
  maxConcurrent: z.number(),
  envAllowlist: z.array(z.string()),
})
export type AdminCommandDto = z.infer<typeof adminCommandDtoSchema>

export const runCommandRequestSchema = z.object({
  args: z.record(z.string(), z.unknown()).default({}),
})
export type RunCommandRequest = z.infer<typeof runCommandRequestSchema>

export const commandRunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'timeout',
])
export type CommandRunStatus = z.infer<typeof commandRunStatusSchema>

export const commandRunDtoSchema = z.object({
  id: z.string(),
  commandId: z.string(),
  status: commandRunStatusSchema,
  exitCode: z.number().nullable(),
  resolvedArgv: z.array(z.string()),
  output: z.string().nullable(),
  truncated: z.boolean(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
})
export type CommandRunDto = z.infer<typeof commandRunDtoSchema>
