import { z } from 'zod'
import { readBuildInfo } from './build-info'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  SESSION_SECRET: z.string().min(1).default('dev-insecure-session-secret-change-me'),
  LOG_LEVEL: z.string().optional(),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().optional(),
  LOGIN_RATE_MAX: z.coerce.number().int().positive().default(10),
  WATCH_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(1500),
  RESCAN_INTERVAL_MIN: z.coerce.number().int().nonnegative().default(360),
  COMMAND_ALLOWED_EXECUTABLES: z.string().optional(),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

export interface AppConfig {
  env: 'development' | 'production' | 'test'
  port: number
  host: string
  dataDir: string
  sessionSecret: string
  logLevel: string | undefined
  adminUsername: string
  /** Bootstrap admin password; if unset on first run, one is generated and logged. */
  adminPassword: string | undefined
  /** Max login attempts per IP per minute before 429. */
  loginRateMax: number
  /** Debounce window for filesystem-watcher-triggered rescans. */
  watchDebounceMs: number
  /** Scheduled full-rescan interval in minutes; 0 disables. */
  rescanIntervalMin: number
  /** Allowlisted executables a command may run (names or absolute paths). */
  commandAllowedExecutables: string[]
  /** Trust X-Forwarded-* (behind the Tailscale Serve TLS proxy). */
  trustProxy: boolean
  version: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env)
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    dataDir: parsed.DATA_DIR,
    sessionSecret: parsed.SESSION_SECRET,
    logLevel: parsed.LOG_LEVEL,
    adminUsername: parsed.ADMIN_USERNAME,
    adminPassword: parsed.ADMIN_PASSWORD,
    loginRateMax: parsed.LOGIN_RATE_MAX,
    watchDebounceMs: parsed.WATCH_DEBOUNCE_MS,
    rescanIntervalMin: parsed.RESCAN_INTERVAL_MIN,
    commandAllowedExecutables: parsed.COMMAND_ALLOWED_EXECUTABLES
      ? parsed.COMMAND_ALLOWED_EXECUTABLES.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    trustProxy: parsed.TRUST_PROXY ?? false,
    version: readBuildInfo().version,
  }
}
