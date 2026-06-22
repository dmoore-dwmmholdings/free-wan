import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Bundle the workspace-only source package; keep real deps (incl. the native
  // better-sqlite3) external and resolved from node_modules at runtime.
  noExternal: ['@free-wan/shared'],
  clean: true,
  sourcemap: true,
  // Stamp the deployed version next to the bundle (read by lib/build-info.ts at runtime).
  onSuccess: 'node scripts/write-build-info.mjs',
})
