import pino from 'pino'
import type { FastifyBaseLogger } from 'fastify'

export function createLogger(env: string, level?: string): FastifyBaseLogger {
  return pino({
    level: env === 'test' ? 'silent' : (level ?? 'info'),
    transport:
      env === 'development'
        ? {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          }
        : undefined,
  })
}
