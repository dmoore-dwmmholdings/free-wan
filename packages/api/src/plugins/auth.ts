import fp from 'fastify-plugin'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Role, Me } from '@free-wan/shared'
import { users, sessions } from '../db/schema'
import { SESSION_COOKIE, SESSION_TTL_MS, newSessionToken } from '../lib/auth'

export interface AuthUser {
  id: string
  username: string
  role: Role
  canRunCommands: boolean
  disabled: boolean
  mustChangePassword: boolean
}

export function toMe(u: AuthUser): Me {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    canRunCommands: u.canRunCommands,
    mustChangePassword: u.mustChangePassword,
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler
    requireAdmin: preHandlerHookHandler
    createSession(userId: string, userAgent?: string): string
    revokeSession(sessionId: string): void
  }
  interface FastifyRequest {
    user: AuthUser | null
    sessionId: string | null
  }
}

/**
 * Resolve the signed session cookie to a live, non-revoked, non-expired user.
 * Returns null on any failure (deny by default). Synchronous: better-sqlite3.
 * Exported so the WebSocket upgrade handler can authenticate with the same logic.
 */
export function resolveSession(app: FastifyInstance, req: FastifyRequest): AuthUser | null {
  const raw = req.cookies[SESSION_COOKIE]
  if (!raw) return null
  const unsigned = req.unsignCookie(raw)
  if (!unsigned.valid || !unsigned.value) return null
  const sessionId = unsigned.value

  const row = app.db
    .select({
      revoked: sessions.revoked,
      expiresAt: sessions.expiresAt,
      id: users.id,
      username: users.username,
      role: users.role,
      canRunCommands: users.canRunCommands,
      disabled: users.disabled,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .get()

  if (!row) return null
  if (row.revoked || row.disabled || row.expiresAt < Date.now()) return null

  req.sessionId = sessionId
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    canRunCommands: Boolean(row.canRunCommands),
    disabled: Boolean(row.disabled),
    mustChangePassword: Boolean(row.mustChangePassword),
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', null)
  app.decorateRequest('sessionId', null)

  app.decorate('createSession', (userId: string, userAgent?: string): string => {
    const token = newSessionToken()
    const now = Date.now()
    app.db
      .insert(sessions)
      .values({
        id: token,
        userId,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
        userAgent: userAgent ?? null,
        revoked: 0,
      })
      .run()
    return token
  })

  app.decorate('revokeSession', (sessionId: string): void => {
    app.db.update(sessions).set({ revoked: 1 }).where(eq(sessions.id, sessionId)).run()
  })

  app.decorate('authenticate', async (req, reply) => {
    const user = resolveSession(app, req)
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Authentication required' } })
    }
    req.user = user
  })

  app.decorate('requireAdmin', async (req, reply) => {
    const user = resolveSession(app, req)
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Authentication required' } })
    }
    if (user.role !== 'admin') {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Admin access required' } })
    }
    req.user = user
  })
})
