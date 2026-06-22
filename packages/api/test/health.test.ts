import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { appMeta } from '../src/db/schema'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp({ env: 'test', dataDir: ':memory:' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('GET /api/health', () => {
  it('returns ok with a version and timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ status: 'ok' })
    expect(typeof body.version).toBe('string')
    expect(typeof body.timestamp).toBe('string')
  })

  it('runs the initial migration (app_meta seeded)', () => {
    const row = app.db
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, 'schema_version'))
      .get()
    expect(row?.value).toBe('0')
  })
})
