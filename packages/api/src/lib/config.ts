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
  REPOSITORIES_FILE: z.string().optional(),
  WATCH_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(1500),
  RESCAN_INTERVAL_MIN: z.coerce.number().int().nonnegative().default(360),
  TRANSCODE_CACHE_MAX_MB: z.coerce.number().int().nonnegative().default(2048),
  TRANSCODE_MAX_HEIGHT: z.coerce.number().int().nonnegative().default(0),
  TRANSCODE_MAXRATE_MBPS: z.coerce.number().int().positive().max(100).default(6),
  COMMAND_ALLOWED_EXECUTABLES: z.string().optional(),
  // Plugins (docs/13-plugins.md). Master switch + optional registry URL for the future catalog.
  PLUGINS_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
  PLUGIN_REGISTRY_URL: z.string().url().optional(),
  PLUGIN_TIMEOUT_S: z.coerce.number().int().positive().max(3600).default(120),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // Native HTTPS — set BOTH to PEM paths to make the server speak TLS directly (e.g. with a
  // `tailscale cert` certificate). Leave unset when TLS is terminated upstream (Tailscale Serve).
  TLS_CERT_FILE: z.string().optional(),
  TLS_KEY_FILE: z.string().optional(),
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
  /**
   * YAML file of repositories to seed into an empty DB on first run (FR-02).
   * When unset, buildApp resolves it to `<repoRoot>/config/repositories.yaml`
   * (the server's cwd is packages/api, so a cwd-relative default would miss it).
   */
  repositoriesFile: string | undefined
  /** Debounce window for filesystem-watcher-triggered rescans. */
  watchDebounceMs: number
  /** Scheduled full-rescan interval in minutes; 0 disables. */
  rescanIntervalMin: number
  /** HLS transcode cache size cap in MB; LRU-evicted past this. 0 disables eviction. */
  transcodeCacheMaxMb: number
  /** Downscale transcodes to at most this height (0 = source resolution). */
  transcodeMaxHeight: number
  /** Transcode bitrate cap in Mbps. */
  transcodeMaxrateMbps: number
  /** Allowlisted executables a command may run (names or absolute paths). */
  commandAllowedExecutables: string[]
  /** Master switch for the plugin subsystem. */
  pluginsEnabled: boolean
  /** Optional URL of a plugin catalog/registry (surfaced in the admin UI). */
  pluginRegistryUrl: string | undefined
  /** Timeout (seconds) for a plugin command/event invocation. */
  pluginTimeoutS: number
  /** Trust X-Forwarded-* (behind the Tailscale Serve TLS proxy). */
  trustProxy: boolean
  /** When set, the server listens with native TLS using these PEM files. */
  tls: { certFile: string; keyFile: string } | undefined
  version: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env)
  if (Boolean(parsed.TLS_CERT_FILE) !== Boolean(parsed.TLS_KEY_FILE)) {
    throw new Error('TLS requires BOTH TLS_CERT_FILE and TLS_KEY_FILE (or neither)')
  }
  const tls = parsed.TLS_CERT_FILE && parsed.TLS_KEY_FILE
    ? { certFile: parsed.TLS_CERT_FILE, keyFile: parsed.TLS_KEY_FILE }
    : undefined
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
    repositoriesFile: parsed.REPOSITORIES_FILE,
    watchDebounceMs: parsed.WATCH_DEBOUNCE_MS,
    rescanIntervalMin: parsed.RESCAN_INTERVAL_MIN,
    transcodeCacheMaxMb: parsed.TRANSCODE_CACHE_MAX_MB,
    transcodeMaxHeight: parsed.TRANSCODE_MAX_HEIGHT,
    transcodeMaxrateMbps: parsed.TRANSCODE_MAXRATE_MBPS,
    commandAllowedExecutables: parsed.COMMAND_ALLOWED_EXECUTABLES
      ? parsed.COMMAND_ALLOWED_EXECUTABLES.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    pluginsEnabled: parsed.PLUGINS_ENABLED ?? true,
    pluginRegistryUrl: parsed.PLUGIN_REGISTRY_URL,
    pluginTimeoutS: parsed.PLUGIN_TIMEOUT_S,
    trustProxy: parsed.TRUST_PROXY ?? false,
    tls,
    version: readBuildInfo().version,
  }
}
