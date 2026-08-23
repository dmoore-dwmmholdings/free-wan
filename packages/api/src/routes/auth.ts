import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  loginRequestSchema,
  changePasswordRequestSchema,
  type Me,
} from '@free-wan/shared'
import { users } from '../db/schema'
import { hashPassword, verifyPassword, sessionCookieOptions, SESSION_COOKIE } from '../lib/auth'
import { toMe } from '../plugins/auth'

const invalidCreds = { error: { code: 'unauthorized', message: 'Invalid username or password' } }

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: app.config.loginRateMax, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = loginRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(422).send({ error: { code: 'validation_error', message: 'Invalid input' } })
      }
      const { username, password } = parsed.data
      const u = app.db.select().from(users).where(eq(users.username, username)).get()
      // Generic failure for missing/disabled/bad-password — no user enumeration.
      if (!u || u.disabled) return reply.code(401).send(invalidCreds)
      if (!(await verifyPassword(password, u.passwordHash))) return reply.code(401).send(invalidCreds)

      const token = app.createSession(u.id, req.headers['user-agent'])
      // `secure` tracks the real transport, not NODE_ENV: a Secure cookie set over plain HTTP
      // (common on the tailnet) is dropped by the browser, which would break login.
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(req.protocol === 'https'))
      const me: Me = {
        id: u.id,
        username: u.username,
        role: u.role,
        canRunCommands: Boolean(u.canRunCommands),
        mustChangePassword: Boolean(u.mustChangePassword),
      }
      return reply.code(200).send({ user: me })
    },
  )

  app.post('/api/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
    if (req.sessionId) app.revokeSession(req.sessionId)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.code(204).send()
  })

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (req, reply) => {
    return reply.send({ user: toMe(req.user!) })
  })

  app.post('/api/auth/password', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = changePasswordRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'Invalid input' } })
    }
    const u = app.db.select().from(users).where(eq(users.id, req.user!.id)).get()
    if (!u) return reply.code(401).send({ error: { code: 'unauthorized', message: 'Unknown user' } })
    if (!(await verifyPassword(parsed.data.currentPassword, u.passwordHash))) {
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Current password is incorrect' } })
    }
    app.db
      .update(users)
      .set({
        passwordHash: await hashPassword(parsed.data.newPassword),
        mustChangePassword: 0,
        updatedAt: Date.now(),
      })
      .where(eq(users.id, u.id))
      .run()
    return reply.code(204).send()
  })
}
