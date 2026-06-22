# ADR 0001 — Scaffold & tooling choices

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 0 (Scaffold)

## Context

AGENTS.md fixes the high-level stack (TypeScript, pnpm workspaces, Fastify, React+Vite,
Drizzle/better-sqlite3, ffmpeg via spawn). A handful of build-tooling details were left to
the implementer. This ADR records them so later phases don't relitigate.

## Decisions

1. **Package manager: pnpm workspaces.** Root `pnpm-workspace.yaml` globs `packages/*`.
   `packageManager` is pinned to `pnpm@11.3.0` so CI (pnpm/action-setup) matches local.

2. **`@free-wan/shared` is consumed as TypeScript source, not a build artifact.** Its
   `exports` map points directly at `./src/index.ts`. This removes any build-ordering
   dependency: `tsx` (api dev), `tsup` (api build, via `noExternal`), and Vite (web, via a
   `resolve.alias`) all bundle the source directly. Tradeoff: consumers must be able to
   compile TS from the dep — every consumer here can.

3. **api build = `tsup` (esbuild).** Bundles `@free-wan/shared` in, keeps real deps
   (incl. the native `better-sqlite3`) external. api dev = `tsx watch`. Output `dist/index.js`.

4. **Migrations via Drizzle's better-sqlite3 migrator** reading `packages/api/migrations`.
   The Phase-0 migration `0000_init.sql` + hand-authored `meta/_journal.json` create a
   minimal `app_meta` table so the migrator is exercised from day one. From Phase 1 on,
   change `src/db/schema.ts` and run `pnpm db:generate` (drizzle-kit) to emit migrations.

5. **One container serves everything.** In production the api serves `packages/web/dist`
   as static files with an SPA fallback; the Dockerfile builds web+api then runs only the
   api process. ffmpeg is installed in the runtime image.

6. **Pinned dependency versions** (no `^`), per AGENTS.md. If `pnpm install` cannot resolve
   a pin, bump it to the nearest existing version and note it here.

## Consequences

- No separate "build shared first" step; topological friction avoided.
- The migrations folder must ship next to `dist/` (both resolve `../migrations` from the
  module dir). The Dockerfile copies the whole `/app`, so this holds.
