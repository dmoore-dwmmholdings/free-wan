import { eq, and } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import {
  createUserRequestSchema,
  updateUserRequestSchema,
  adminResetPasswordRequestSchema,
  type UserDto,
} from '@free-wan/shared'
import { users, type UserRow } from '../../db/schema'
import { hashPassword } from '../../lib/auth'

function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    canRunCommands: Boolean(u.canRunCommands),
    disabled: Boolean(u.disabled),
    mustChangePassword: Boolean(u.mustChangePassword),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }
}

/** Count of admins that can still log in (admin role and not disabled). */
function enabledAdminCount(app: FastifyInstance, excludeUserId?: string): number {
  const rows = app.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, 0)))
    .all()
  return rows.filter((r) => r.id !== excludeUserId).length
}

const validationError = { error: { code: 'validation_error', message: 'Invalid input' } }
const notFound = { error: { code: 'not_found', message: 'User not found' } }
const lastAdmin = {
  error: { code: 'conflict', message: 'Cannot remove or disable the last admin' },
}

export async function adminUserRoutes(app: FastifyInstance): Promise<void> {
  // Every route in this module is admin-only (deny by default).
  app.addHook('preHandler', app.requireAdmin)

  app.get('/api/admin/users', async () => {
    const rows = app.db.select().from(users).all()
    return { data: rows.map(toUserDto) }
  })

  app.post('/api/admin/users', async (req, reply) => {
    const parsed = createUserRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { username, password, role, canRunCommands } = parsed.data

    const exists = app.db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()
    if (exists) {
      return reply.code(409).send({ error: { code: 'conflict', message: 'Username already exists' } })
    }

    const now = Date.now()
    const id = uuidv7()
    app.db
      .insert(users)
      .values({
        id,
        username,
        passwordHash: await hashPassword(password),
        role,
        canRunCommands: canRunCommands ? 1 : 0,
        disabled: 0,
        mustChangePassword: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    const row = app.db.select().from(users).where(eq(users.id, id)).get()!
    return reply.code(201).send(toUserDto(row))
  })

  app.patch('/api/admin/users/:id', async (req, reply) => {
    const parsed = updateUserRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    const target = app.db.select().from(users).where(eq(users.id, id)).get()
    if (!target) return reply.code(404).send(notFound)

    // Guard the last admin: block demotion or disabling that would leave zero admins.
    const demoting = parsed.data.role === 'user' && target.role === 'admin'
    const disabling = parsed.data.disabled === true && target.role === 'admin' && !target.disabled
    if ((demoting || disabling) && enabledAdminCount(app, id) === 0) {
      return reply.code(409).send(lastAdmin)
    }

    const patch: Partial<UserRow> = { updatedAt: Date.now() }
    if (parsed.data.role !== undefined) patch.role = parsed.data.role
    if (parsed.data.disabled !== undefined) patch.disabled = parsed.data.disabled ? 1 : 0
    if (parsed.data.canRunCommands !== undefined) {
      patch.canRunCommands = parsed.data.canRunCommands ? 1 : 0
    }
    app.db.update(users).set(patch).where(eq(users.id, id)).run()
    const row = app.db.select().from(users).where(eq(users.id, id)).get()!
    return reply.send(toUserDto(row))
  })

  app.post('/api/admin/users/:id/password', async (req, reply) => {
    const parsed = adminResetPasswordRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    const target = app.db.select({ id: users.id }).from(users).where(eq(users.id, id)).get()
    if (!target) return reply.code(404).send(notFound)
    app.db
      .update(users)
      .set({
        passwordHash: await hashPassword(parsed.data.newPassword),
        mustChangePassword: 1, // force the user to set their own on next login
        updatedAt: Date.now(),
      })
      .where(eq(users.id, id))
      .run()
    return reply.code(204).send()
  })

  app.delete('/api/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const target = app.db.select().from(users).where(eq(users.id, id)).get()
    if (!target) return reply.code(404).send(notFound)
    if (target.role === 'admin' && enabledAdminCount(app, id) === 0) {
      return reply.code(409).send(lastAdmin)
    }
    // sessions cascade-delete via the FK.
    app.db.delete(users).where(eq(users.id, id)).run()
    return reply.code(204).send()
  })
}
