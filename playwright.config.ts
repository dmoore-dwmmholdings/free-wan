import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// E2E suite (Phase 10 polish): drives the REAL built app — `node packages/api/dist/index.js`
// serving `packages/web/dist` — in a real browser. Run `pnpm -r build` first, then
// `pnpm test:e2e`. State lives under e2e/.data and is wiped by the global setup.
const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8199',
    trace: 'retain-on-failure',
    // The player relies on autoplay (unmuted); lift Chromium's gesture requirement in tests.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    // The wrapper wipes e2e/.data and generates the media fixture, then boots the built API.
    // (It can't be a Playwright globalSetup: webServer launches before globalSetup runs.)
    command: 'node e2e/start-server.mjs',
    url: 'http://127.0.0.1:8199/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      PORT: '8199',
      HOST: '127.0.0.1',
      DATA_DIR: join(here, 'e2e', '.data'),
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'e2e-admin-pass-1',
      SESSION_SECRET: 'e2e-only-session-secret-not-for-production',
      RESCAN_INTERVAL_MIN: '0',
      // Every test logs in fresh; don't let the per-IP login rate limit starve later specs.
      LOGIN_RATE_MAX: '1000',
      // Keep the run hermetic: no repo seeding from the real config, no plugin subsystem.
      REPOSITORIES_FILE: join(here, 'e2e', 'no-seed.yaml'),
      PLUGINS_ENABLED: 'false',
      // Lets the commands e2e flow define and run a real (sandboxed) `node` command.
      COMMAND_ALLOWED_EXECUTABLES: 'node',
    },
  },
})
