import { describe, it, expect } from 'vitest'
import { healthResponseSchema } from '../src/health'

describe('healthResponseSchema', () => {
  it('accepts a valid health payload', () => {
    const r = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.0.0',
      uptime: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a non-ok status', () => {
    const r = healthResponseSchema.safeParse({ status: 'down' })
    expect(r.success).toBe(false)
  })
})
