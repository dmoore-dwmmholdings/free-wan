import type { FastifyInstance } from 'fastify'
import { healthResponseSchema, type HealthResponse } from '@free-wan/shared'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const body: HealthResponse = {
      status: 'ok',
      version: app.config.version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
    // Validate our own output against the shared contract.
    return healthResponseSchema.parse(body)
  })
}
