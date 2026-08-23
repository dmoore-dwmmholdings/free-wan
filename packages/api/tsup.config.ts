import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Bundle the workspace-only source package; keep real deps (incl. the native
  // better-sqlite3) external and resolved from node_modules at runtime.
  // EXCEPTION: a dep added after a release must be bundled — update packages are
  // code-only (no node_modules), so a new external dep crashes servers updating
  // from an older install ("Cannot find package …" at boot → supervisor rollback).
  // `yaml` was added in 0.6.1 (repositories.yaml seeding); bundle it.
  noExternal: ['@free-wan/shared', 'yaml'],
  // Bundled CJS deps (yaml) require() Node builtins at runtime; in ESM output esbuild's
  // __require shim throws "Dynamic require of … is not supported" unless a real `require`
  // exists in module scope. Provide one.
  banner: {
    js: "import { createRequire as __fwCreateRequire } from 'node:module'; const require = __fwCreateRequire(import.meta.url);",
  },
  clean: true,
  sourcemap: true,
  // Stamp the deployed version next to the bundle (read by lib/build-info.ts at runtime).
  onSuccess: 'node scripts/write-build-info.mjs',
})
