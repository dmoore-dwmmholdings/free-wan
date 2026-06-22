# ADR 0014 — Web component testing (post-v1)

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** post-v1 polish

## Context

Through Phases 0–10 the **web** package had no automated tests — every phase's handoff
carried a "browser pass pending" caveat for the UI. The backend was thoroughly tested (104
tests) but component behavior (guards, like toggle, gallery navigation, the API client) was
only ever exercised by hand via live smokes.

## Decision

Add a Vitest + **happy-dom** + **@testing-library/react** setup to `packages/web`
(`vitest.config.ts`: `environment: 'happy-dom'`, `globals: true`, the same
`@free-wan/shared` source alias as the Vite build). No browser download — happy-dom is a
pure-JS DOM, so the tests run anywhere `pnpm -r test` runs (incl. CI).

Initial coverage (`packages/web/test/`):

- **`format.test.ts`** — `formatDuration`/`resolutionLabel`/`rawUrl` pure helpers.
- **`api.test.ts`** — the fetch client: JSON on 200, `undefined` on 204, `ApiError` (with
  `status`+`code`) on non-2xx, correct method/body/headers (fetch stubbed via `vi.stubGlobal`).
- **`LikeButton.test.tsx`** — renders in a `QueryClientProvider`, click issues `PUT`/`DELETE
  /api/media/:id/like` per current state.
- **`GalleryViewer.test.tsx`** — position indicator + ArrowLeft/Right navigation (with clamp)
  + Escape-to-close.

Test files are intentionally **not** in the web `tsconfig` include (kept out of `tsc
--noEmit`); Vitest/esbuild transpiles them. Tests import vitest symbols explicitly;
`globals: true` is kept so Testing Library's auto-cleanup registers.

## Verification

- `pnpm --filter @free-wan/web test` → **11/11**. Full monorepo: typecheck 3/3, build all,
  **117 tests** (shared 2, web 11, api 104). CI (`pnpm -r test`) now exercises the web package.

## Follow-ups (still post-v1)

This complements but does not replace **Playwright e2e** (real-browser flows: login → browse
→ play → gallery → clip → run a command) — the top remaining polish item. Component tests
here cover unit/interaction logic; e2e covers the integrated app behind the real server.
