# Build progress — read this first

> **For the next build agent.** This is the running handoff log for the Free-WAN build.
> Update it at the end of every working session: tick what you finished, record what you
> verified, and leave the very next concrete action at the top of "Next up". The spec is in
> the other `docs/`; this file is the *state of the build*.

- **Spec source of truth:** `docs/01`–`docs/13`. Build order: [`docs/14-build-plan.md`](14-build-plan.md).
- **Conventions / definition-of-done:** [`AGENTS.md`](../AGENTS.md).
- **Decisions log:** [`docs/decisions/`](decisions/).

---

## Status board

| Phase | Title | State |
|------:|-------|-------|
| 0 | Scaffold | ✅ **done & verified** — typecheck, tests, build, and live server all green |
| 1 | Auth & users | ✅ **done & verified** — backend 15/15 tests + live flow; login/guard UI builds |
| 2 | Repositories, scanning, metadata, categories | ✅ **done & verified** — scanner/jobs/repo-CRUD + chokidar watcher + WS scan progress + scheduled rescan (39 api tests + live watcher smoke) |
| 3 | Discovery & thumbnails | ✅ **done & verified** — FTS5 search, GET /api/media (filter/sort/paginate), detail, category tree, poster thumbnails, Browse+Detail UI (47 api tests + live ffmpeg poster) |
| 4 | Video playback | ✅ **done & verified** — direct-play (ranged /stream) + on-the-fly HLS transcode (single-flight, cached), playback decision, WebVTT captions, resume/watched, hls.js player (62 api tests + live ffmpeg HLS smoke). Polish deferred: scrub sprites, Vidstack swap |
| 5 | Likes & collections | ✅ **done & verified** — like toggle + real counts in /api/media, liked filter, popularity sort, collections CRUD + reorder, per-user isolation, web UI (69 api tests + live smoke) |
| 6 | Images gallery | ✅ **done & verified** — /raw?w= sized variants + full-screen GalleryViewer (swipe/keys/tap zones, slideshow, neighbor preload, reduced-motion) (73 api tests + live ffmpeg resize). Browser pass for the overlay still pending |
| 7 | Clips & loops | ✅ **done & verified** — clips CRUD + range validation, virtual-loop preview, clip_export ffmpeg job + download, orphan handling, ClipBuilder + /clips grid (81 api tests + live ffmpeg export) |
| 8 | Branding | ✅ **done & verified** — settings table, public GET /api/branding, admin PUT (deep-merge), SVG-sanitized asset upload, ThemeProvider (runtime CSS vars) + BrandingEditor (87 api tests + live upload/sanitize smoke) |
| 9 | Custom commands & automation | ✅ **done & verified** — commands schema, no-shell argv builder, validation, sandboxed runner (env allowlist/cwd jail/timeout/output cap/cancel), run endpoints + Commands UI (100 api tests incl. real-spawn injection/env/cancel). Admin CommandEditor UI deferred |
| 10 | Hardening, deploy, polish | ✅ **core done & verified** — CSP/HSTS/headers (helmet) + trustProxy, admin System panel (system/jobs/cache-clear), non-root Docker + Tailscale Serve + GPU variant, backup docs (104 api tests + live headers/system smoke). Polish (PWA/a11y/Playwright) deferred |

---

## Phase 0 — Scaffold (current)

**Goal (from build plan):** a running, empty full-stack skeleton; `docker compose up`
serves a hello page and `GET /api/health` returns ok. Covers NFR-04, NFR-10.

### What exists now

```
free-wan/
├── package.json                 # pnpm workspace root, scripts: dev/build/test/typecheck
├── pnpm-workspace.yaml          # globs packages/*
├── tsconfig.base.json           # shared strict TS config (Bundler resolution)
├── .npmrc .gitignore .dockerignore .env.example
├── Dockerfile                   # multi-stage: build web+api → runtime w/ ffmpeg
├── docker-compose.yml           # free-wan service (+ commented Tailscale sidecar, Phase 10)
├── config/
│   ├── repositories.yaml        # empty list (drives added in Phase 2)
│   └── free-wan.example.yaml
├── .github/workflows/ci.yml     # install → typecheck → build → test
└── packages/
    ├── shared/                  # zod schemas + types, consumed as SOURCE (no build step)
    │   └── src/{index,health}.ts  → apiErrorSchema, healthResponseSchema
    ├── api/                     # Fastify server
    │   ├── src/index.ts           → boot + listen + graceful shutdown
    │   ├── src/app.ts             → buildApp(): db+migrate, /api/health, static web w/ SPA fallback
    │   ├── src/lib/{config,logger}.ts
    │   ├── src/db/{schema,client,migrate}.ts
    │   ├── src/routes/health.ts
    │   ├── migrations/0000_init.sql (+ meta/_journal.json)  → app_meta table
    │   └── test/health.test.ts
    └── web/                     # React 18 + Vite + Tailwind
        └── src/{main,App}.tsx     → "Free-WAN" hello page that pings /api/health
```

### Key implementation notes (so you don't have to re-derive them)

- **`@free-wan/shared` is source-only.** Its `package.json` `exports` points at
  `./src/index.ts`. api dev uses `tsx`, api build uses `tsup` with
  `noExternal: ['@free-wan/shared']`, web uses a Vite `resolve.alias`. No build-order
  dependency between packages. See ADR 0001.
- **DB:** `openDatabase(dataDir)` opens `data/free-wan.db` (WAL, FK on). `:memory:` is
  honored for tests. `runMigrations()` applies `packages/api/migrations` via Drizzle's
  migrator. Migration folder is resolved as `../migrations` from the module dir, which
  holds in dev (`src/`) and prod (`dist/`).
- **Health contract** lives in `@free-wan/shared` (`healthResponseSchema`) and is validated
  on the way out of the route — the pattern every future route should follow (zod at the
  boundary, shared types).
- **Prod serving:** `buildApp` registers `@fastify/static` on `packages/web/dist` only if it
  exists, with an SPA fallback that 404s `/api/*` and serves `index.html` otherwise.
- **Pinned versions** everywhere (AGENTS.md rule). If a pin fails to resolve on install,
  bump to nearest and note it in ADR 0001.

### How to run / verify (do this first when you pick up)

```bash
pnpm install                 # builds native better-sqlite3
pnpm -r typecheck            # all three packages clean
pnpm -r test                 # shared schema test + api /api/health inject test
pnpm --filter @free-wan/api dev     # http://localhost:8080/api/health → {"status":"ok",...}
pnpm --filter @free-wan/web dev     # http://localhost:5173  (proxies /api → 8080)
# Full prod path:
pnpm -r build && pnpm --filter @free-wan/api start   # api serves built web on :8080
# Docker:
docker compose up --build    # then GET http://localhost:8080/api/health
```

### ✅ Verification status — all green (2026-06-21)

- `pnpm install`: ✅ all 4 projects, every pinned version resolved (no pin changes needed).
- `pnpm -r typecheck`: ✅ shared, api, web all clean.
- `pnpm -r test`: ✅ shared 2/2, api 2/2 (incl. migrator exercising better-sqlite3); web
  has no tests yet (`--passWithNoTests`).
- `pnpm -r build`: ✅ web → `packages/web/dist` (Vite, ~144 kB js), api → `dist/index.js` (tsup).
- **Live built server** (`node dist/index.js`): ✅ `/api/health` returns ok; `/` serves the
  web shell; client routes (`/browse`) hit the SPA fallback (200); `/api/*` 404s with the
  standard error envelope. `pnpm-lock.yaml` is present.

### ⚠️ One gotcha for a fresh clone (native module)

`better-sqlite3` is native. pnpm 10/11 blocks postinstall build scripts by default. This
repo allowlists it two ways in `pnpm-workspace.yaml` (`onlyBuiltDependencies` + the
harness-managed `allowBuilds`), so `pnpm install` *should* build it. If you ever see
`Could not locate the bindings file ... better_sqlite3.node`, fetch the prebuilt binary:

```bash
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npx --yes prebuild-install
```

(or `pnpm approve-builds` interactively, or `npm run build-release` to compile from source).
**Commit `pnpm-lock.yaml`** so CI/Docker `--frozen-lockfile` stays reproducible.

---

## Phase 1 — Auth & users (done & verified)

**Goal:** login works; roles enforced; bootstrap admin; forced password change. Covers
FR-58–61, NFR-06.

### What exists now

- **DB:** `users` + `sessions` tables (`src/db/schema.ts`), migration `0001_auth.sql`
  (+ journal entry). Added `users.must_change_password` (ADR 0002; data model updated).
- **Auth lib** (`src/lib/auth.ts`): Argon2id via **`hash-wasm`** (pure WASM — no native
  build), opaque 32-byte session tokens, signed-cookie options. `SESSION_COOKIE='fw_session'`,
  30-day absolute TTL.
- **Auth plugin** (`src/plugins/auth.ts`, fastify-plugin): `app.authenticate` /
  `app.requireAdmin` preHandlers (deny by default), `req.user`, `createSession`/`revokeSession`.
- **Routes:** `src/routes/auth.ts` (login [rate-limited], logout, me, password) and
  `src/routes/admin/users.ts` (list/create/patch/reset-password/delete; **last-admin guard**;
  409 on duplicate username).
- **Bootstrap** (`src/lib/bootstrap.ts`): first-run admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD`
  (generates + logs a password if unset), flagged `must_change_password`. Wired in `app.ts`
  along with `@fastify/cookie` + `@fastify/rate-limit`.
- **Config:** added `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `LOGIN_RATE_MAX` (`.env.example` updated).
- **Shared:** `packages/shared/src/auth.ts` — zod schemas + types (`Me`, `UserDto`, login/
  create/update/change-password requests).
- **Web:** TanStack Query + React Router wired (`main.tsx`). API client (`lib/api.ts`),
  auth hooks (`lib/auth.ts`), `LoginPage`, `ChangePasswordPage` (handles the forced flow),
  `RequireAuth` guard, `HomePage` (user chip + sign-out), `AuthCard` UI kit.

### ✅ Verification — all green (2026-06-21)

- `pnpm -r typecheck` ✅ · `pnpm -r build` ✅ (web 152 kB, api tsup) · `pnpm -r test` ✅
  **shared 2/2, api 15/15** (health 2 + auth 13: bootstrap, generic-401, me-requires-auth,
  create→login, duplicate-409, **authz matrix anon/user/admin × public/user/admin**,
  change-password, disabled-login, logout-revocation, last-admin delete+demote guards,
  **rate-limit 429**).
- **Live built server** end-to-end (curl + cookie jar): 401 without session → login (UUIDv7,
  `mustChangePassword:true`) → authed `me` → admin lists users → bad-pw 401 → change-pw 204
  → `mustChangePassword:false` → admin creates user → **non-admin gets 403 on `/api/admin/*`**.

### ⚠️ Notes for the next agent

- **Migrations are hand-authored SQL** applied by the Drizzle migrator (same as Phase 0).
  `pnpm db:generate` won't diff correctly until `meta/000N_snapshot.json` files are
  backfilled — either do that to adopt drizzle-kit, or keep hand-authoring. (ADR 0002 §6.)
- The login UI **builds and typechecks**; it was also driven in a real browser post-v1
  (Claude Preview: login → forced change-password → app). A Playwright login flow is still
  part of the Phase 10 e2e set.
- **Missing-web-build diagnostics (post-v1, 2026-06-21).** `app.ts` now checks for
  `web/dist/index.html` (not just the dir), logs `Serving web UI from …` when found, and
  when absent logs a `WARN` + serves a plain-text 503 with build instructions at non-API
  routes instead of Fastify's bare "Route GET:/ not found". Reason: `pnpm start` only runs
  the API (`node dist/index.js`) and never builds the web, so running it without a prior
  `pnpm -r build` (or `pnpm --filter @free-wan/web build`) produced a confusing "cannot GET /".
- **Bootstrap-admin reconcile (post-v1 fix, 2026-06-21).** `lib/bootstrap.ts` was a silent
  no-op once any admin existed, so an `ADMIN_PASSWORD` set *after* the first boot (which had
  generated + logged a random password, easy to miss on a headless server) never took effect
  and the operator couldn't sign in. Now the env-configured credentials are reapplied on
  startup **while the admin still has `must_change_password`** (i.e. setup not finished), and
  are left untouched once the admin changes its password through the app (so a UI-chosen
  password is never clobbered). Covered by `test/bootstrap.test.ts` (file-backed DB, 2 tests).
- CSRF currently relies on SameSite=Lax + same-origin (acceptable for Phase 1); a custom
  header / token is a Phase 10 hardening item per `docs/13-security.md` §2.

---

## Phase 2 — Repositories, scanning, categories (DONE & verified)

**Goal:** point at drives → a populated, auto-categorized index. Covers FR-01–15, NFR-05.

### What exists now

- **Schema + migration `0002_media`:** `repositories`, `media_items`, `categories`,
  `media_categories`, `subtitle_tracks`, `jobs` (`src/db/schema.ts`).
- **Pure logic (all unit-tested):** `lib/media-types.ts` (classify/ignore/title),
  `lib/categories.ts` (`deriveCategoryChain`), `lib/playback.ts` (`decidePlaybackMode`),
  `services/ffprobe.ts` (`mapProbe` + `createFfprobe` — spawn, no shell).
- **Job worker** (`workers/worker.ts`): `jobs`-table-backed, concurrency 2, `kick()` +
  `onIdle()`. `services/jobs.ts` = `enqueueJob`/`getJob`.
- **Scanner** (`services/scanner.ts`): `runScan(db, repoId, prober, opts)` — incremental
  walk (skip unchanged by path+size+mtime), upsert, derive+link category chain with
  `item_count` + prune, sidecar subtitle detection (`film.en.srt`→lang), embedded subs,
  missing/offline sweep. **Prober is injectable** (real ffprobe in prod, fake in tests).
- **Repo CRUD + scan routes** (`routes/admin/repositories.ts`): list/create(validates path
  exists)/patch/delete(purge); `POST /:id/scan` → 202 `{jobId}` + `worker.kick()`;
  `GET /:id/scan` → status + `found/indexed/failed/removed`. Wired in `app.ts`; `buildApp`
  takes a 2nd `deps` arg (`{ prober }`) for tests.
- **Shared:** `packages/shared/src/media.ts` (repository DTO + request/scan schemas).

### Realtime + watcher (added to complete the phase)

- **EventHub** (`services/events.ts`) pub/sub; **WebSocket** `/api/ws` (`routes/ws.ts`,
  `@fastify/websocket`) cookie-authenticated on upgrade (reuses exported `resolveSession`),
  topic-prefix allowlist (`scan:`/`job:`/`run:`). Scan emits `onProgress` → published to
  `scan:{repoId}` as `{type:'scan', repositoryId, status, progress, found, indexed, failed, removed}`.
- **WatcherManager** (`services/watcher.ts`, `chokidar`) — repo-level debounced incremental
  rescan (`WATCH_DEBOUNCE_MS`), synced from DB on boot + after repo create/patch/delete,
  disabled under tests. **Scheduled full rescan** (`RESCAN_INTERVAL_MIN`, 0 disables). See ADR 0004.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 39/39** (units 11, scanner 4,
  repositories 4, realtime 5 [hub, watcher debounce, scan-progress publish, WS auth-reject,
  WS subscribe+forward], auth 13, health 2).
- **Live built server, REAL ffprobe + watcher:** create repo → scan (`itemCount 1`) → **add a
  new file → watcher auto-rescans → `itemCount 2`, no restart** (FR-13). Earlier smoke also
  confirmed real-ffprobe metadata extraction.

### Still deferred (minor, non-blocking — pick up anytime)

- ~~Seed repositories from `config/repositories.yaml` on boot~~ — **done 2026-07-14** (see
  post-v1 log): `lib/seed-repositories.ts`, one-shot via an `app_meta` flag, queues initial
  scans; `REPOSITORIES_FILE` overrides the default `<repoRoot>/config/repositories.yaml`.
- ~~Case-insensitive category matching~~ — **done 2026-07-14** (see post-v1 log): migration
  `0012_categories_nocase` merges case-duplicates + recreates `idx_categories_repo_path`
  with `COLLATE NOCASE`; the scanner lookup matches `path = ? COLLATE NOCASE`. First-seen
  display case wins (ADR 0003 §4 resolved).

### Post-v1 — admin Repositories UI (DONE & verified, 2026-06-21)

The repo CRUD API existed but had **no web UI** (the System panel only listed repos
read-only), so data directories couldn't be configured from the browser. Added:

- `packages/web/src/lib/repositories.ts` — TanStack Query hooks over `/api/admin/repositories`
  (list polled every 5s; create/patch/delete/scan with cache invalidation).
- `packages/web/src/routes/RepositoriesPage.tsx` (`/settings/repositories`, admin-guarded) —
  add-library form (name/path/type/read-only, surfaces the 422 "rootPath does not exist"),
  per-repo rows with status/itemCount/lastError + Scan / Enable-Disable / inline Edit / Remove.
- Wired into `App.tsx` routing + `AppHeader` admin nav; "Manage →" link added to the System panel.
- **Verified in a real browser** (Claude Preview): login → forced change-password → add a
  library through the form → repo persisted (confirmed via API), no console errors.

### Post-v1 — Browse: pagination, repo-type tabs, category navigation (DONE & verified, 2026-06-21)

Three related Browse gaps, reported by the owner ("only one repo's videos show", "not
categorizing", "want photos/video tabs"):

- **Pagination (the real "missing media" bug).** `BrowsePage` only ever rendered page 1
  (server default `limit=50`) — with >50 items you saw only the newest-scanned repo. The API
  already returned `nextCursor`; the page just ignored it. Added `useInfiniteMediaList`
  (`useInfiniteQuery`) + an IntersectionObserver sentinel (and a "Load more" fallback) in
  `lib/media.ts` / `BrowsePage.tsx`. The scanner/discovery do **not** filter by repo type —
  that was never the cause.
- **Repo-type tabs (All / Videos / Photos).** New `repositoryType` filter on `GET /api/media`
  *and* `GET /api/categories` (`shared/media.ts`, `routes/media.ts`, `routes/categories.ts`):
  Videos→`video`, Photos→`image,mixed`. Tabs live in the URL (`?repositoryType=…`).
- **Folder categories surfaced.** Categorization always ran server-side (`deriveCategoryChain`);
  it just had no UI. Added `components/CategoryBar.tsx` (breadcrumb + drill-down chips with
  counts) + `useCategoryChildren`/`useCategoryDetail`, scoped to the active tab's repo type.
- **Tests:** `test/repo-type-filter.test.ts` (2 repos, 3 tests). **Verified in a real browser**:
  All=72, Videos=60 with all 60 paginated in, Action folder=35, Photos=12 with only `Trip`
  folder; no console errors.

### Post-v1 — gallery/player UX + photo uploads + de-emoji (DONE & verified, 2026-06-21)

Owner feedback batch:

- **Photos-tab immersive gallery (A, D).** In the Photos tab, *every* card (photos **and**
  videos) opens the full-screen `GalleryViewer` for swipe-through; gallery videos already
  autoplay (motion-permitting) + `loop` + muted. Images/videos use `object-contain` so tall
  media fits. Added a **Details** link in the gallery chrome → the metadata view (`DetailPage`,
  capped at 60vh). Elsewhere (All/Videos tabs) a video card links straight to the player.
- **Immediate playback (C).** Video cards (outside the Photos gallery) link directly to
  `/watch/:id`; `VideoPlayer` now has `autoPlay` and `max-h-[80vh]`. No more click-through a
  detail page + Play button.
- **No emojis (B).** Replaced all UI glyphs (`♥ ▶ ⏸ ✕ ✂ ✓` and decorative arrows) with inline
  SVGs (`components/icons.tsx`: Heart/Close/Play/Pause/Upload) or plain words. Saved as a
  standing user preference — **do not introduce emojis anywhere**.
- **Photo uploads (E).** New `routes/uploads.ts`: `GET /api/upload/targets` (writable +
  image/mixed repos) and `POST /api/repositories/:id/upload` (multipart, image-only, writes to
  `<root>/Uploads/`, dedupes, enqueues an incremental scan). Frontend: `components/UploadButton.tsx`
  + `lib/uploads.ts`, shown in the Photos-tab toolbar. Uploads require a repo with **Read-only
  unchecked**. `api.upload()` added for multipart POSTs. Multipart fileSize raised per-route to 50 MB.
- **Tests:** `test/uploads.test.ts` (4). `GalleryViewer.test.tsx` now wraps in `MemoryRouter`
  (the Details link needs router context). **Verified in a real browser**: Photos-tab video
  opens the gallery (loop=true, muted, object-contain, SVG close, Details link); All-tab video
  card → `/watch` with `autoplay=true`; live upload of a real JPEG indexed and appeared
  (Photos 3→4); zero emoji glyphs in the DOM; no console errors.

### Post-v1 — self-update from an uploaded package + changelog (DONE & verified, 2026-06-21)

Upload a package in **System → Software updates**, it applies and auto-restarts, and the history
panel confirms the new version. **Code-only & data-safe by construction** — only the three built
artifacts are swapped; `DATA_DIR` and env config are never touched. Plan:
`~/.claude/plans/dreamy-orbiting-riddle.md`.

- **Package** (`.zip`): `manifest.json` (formatVersion, version, changelog, sha256), `build-info.json`,
  `api/dist`, `api/migrations`, `web/dist`. Built by `pnpm package` (`scripts/package-release.mjs`,
  uses **adm-zip** — new dep in `packages/api`, needs one `pnpm install`). Changelog pulled from
  `CHANGELOG.md`.
- **Apply** — `services/updater.ts` (path-injectable): validate (format/version/required files/
  sha256) → stage → back up current code to `repoRoot/.fw-update/backups` → swap (rename, copy-
  fallback) → write `pending.json`. Restore-on-error. Routes: `routes/admin/updates.ts`
  (`GET` history, `POST` upload→`exit(75)`, `POST .../rollback`). Boot reconcile
  (`services/update-reconcile.ts`) marks the row `success` once the new version is live.
- **Restart/rollback** — `packages/api/supervisor.mjs` is the `pnpm start` entrypoint (root
  `start` → `pnpm --filter @free-wan/api start` → `node supervisor.mjs`; sets `FW_SUPERVISED=1`,
  spawns the API). It lives inside the api package so it always deploys with the app. Exit 0 =
  stop, **75 = relaunch (update)**, crash-loop after an update = **restore the backup
  automatically**. `start:direct` (both root and api) runs `node dist/index.js` for
  process-manager deploys.
- **Version** — `lib/build-info.ts` reads `dist/build-info.json` (stamped by tsup `onSuccess`
  → `scripts/write-build-info.mjs`) so the System panel shows the *deployed* version.
- **DB** — migration `0009_updates.sql` + `app_updates` table (additive, data-safe).
- **UI** — `components/UpdatePanel.tsx` + `lib/updates.ts` in `SystemPage` (no emojis).
- **Tests:** `test/updates.test.ts` (5: apply/swap/backup, DATA_DIR untouched, format + checksum
  rejection, rollback). **Verified live under the supervisor** on an isolated DATA_DIR: 0.1.0 →
  uploaded 0.2.0 → auto-restart → 0.2.0 live, admin+repo preserved, history "success"; then a
  valid-but-crashing 0.3.0 → 3 crashes → **auto-rollback to 0.2.0**, data intact.

---

## Phase 3 — Discovery & thumbnails (DONE & verified)

**Goal:** a fast, searchable, sortable browse experience. Covers FR-16–22, NFR-01.

### What exists now

- **FTS5 search:** `media_fts` virtual table (migration `0003_fts`); `services/fts.ts`
  (`upsertFts`/`deleteFts`/`searchFtsIds`, safe quoted-prefix MATCH). Scanner populates it
  per item (title + filename + folder category names) so folder terms are searchable.
- **`GET /api/media`** (`routes/media.ts`): filters `type`/`repository`/`category` (nested)/
  `minHeight`/`min|maxDuration`/`q`; sorts `title|added|created|duration` (popularity = Phase 5);
  opaque offset cursor → `{data, nextCursor, total}`. Cards carry leaf `categoryPath` + `posterUrl`.
- **`GET /api/media/:id`** detail (metadata + category chain + subtitles + playbackMode).
- **`GET /api/media/:id/poster`** streams the generated poster (1-day cache).
- **Categories tree:** `GET /api/categories?repository=&parent=` (children + `hasChildren` +
  `itemCount`), `GET /api/categories/:id` (node + ancestors). `routes/categories.ts`.
- **Thumbnails:** injectable `Thumbnailer` (`services/thumbnailer.ts`, real ffmpeg/fake);
  scanner `onIndexed` → `thumbnail` job → `data/thumbs/<id>/poster.jpg`, `poster_path` set.
- **Web:** `BrowsePage` (search + type/sort filters + responsive grid, URL-as-state),
  `DetailPage` (poster + metadata + category breadcrumbs), `AppHeader`. `/` = Browse,
  `/media/:id` = detail, both guarded.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 47/47** (+8 discovery: list, FTS via
  title & **folder name**, type + nested-category filters, title sort, cursor pagination,
  detail chain, poster serving, category tree, authz).
- **Live built server, REAL ffmpeg:** scan → `GET /api/media` cards (categoryPath
  `Films/Action`), `?q=hero` search, detail (`h264`/direct), and a real **480×270 JPEG
  poster** served (HTTP 200, 9.9 kB).

### Deferred (non-blocking — see ADR 0005)

- Sprite sheets (scrub previews) + `/raw?w=` resized variants → do in **Phase 4/6** where used.
- Virtualized grid; dedicated category-browser page; keyset (vs offset) pagination;
  relevance sort; large-library perf load-test (NFR-01 → Phase 10). Liked filter +
  popularity sort → **Phase 5**.

---

## Phase 4 — Video playback (direct-play done; HLS remains)

**Goal:** play anything, with speed, captions, resume. Covers FR-23–30, NFR-02/03.

### What exists now (direct-play path, verified)

- **Path safety:** `lib/path-safety.ts` `resolveWithinRoot` (realpath + prefix check;
  rejects traversal/symlink-escape/absolute/missing). Single gate for byte access.
- **`GET /api/media/:id/playback`** → `{mode, url, captions[], resumeAt, duration}` from the
  cached `playback_mode`. **`GET /api/media/:id/stream`** ranged (206/416, Accept-Ranges,
  content-type). **`GET /api/media/:id/captions/:trackId.vtt`** (sidecar `.vtt` verbatim;
  `.srt`/embedded via injectable `CaptionConverter`). **`POST /api/media/:id/progress`**.
- **Resume/watched:** `playback_progress` table (migration `0004_playback`, per-user PK);
  sticky watched at ≥92%; per-user isolation.
- **Web:** native `<video>` `VideoPlayer` (resume, captions, speed, throttled progress) —
  **isolated for a Vidstack swap**; `/watch/:id` theater route + Play button on detail.
- New injectable dep: `captionConverter` (alongside `prober`, `thumbnailer`) in `buildApp`.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 55/55** (+8 playback: path-safety
  traversal, direct descriptor, full stream, 206 range, sidecar VTT, resume/watched,
  per-user isolation, auth).
- **Live built server, real mp4:** descriptor `mode:direct`; ranged stream `206`
  `Content-Range: bytes 0-99/30374`; progress save → `resumeAt 12.5`.

### HLS transcode (added to complete the phase — ADR 0007)

- **`TranscodeManager`** (`services/transcode.ts`, injectable starter) — single-flight per
  item, completed transcodes reused from `data/hls/<id>/`, idle sweep. Routes
  `GET /hls/master.m3u8` (starts/ensures) + `GET /hls/:file` (validated playlist/segment).
- Player plays HLS via **hls.js** (native fallback). **Decision bug fixed:**
  `decidePlaybackMode` keys the container check on **file extension** (not ffprobe's
  ambiguous `format_name`), so `.mkv`/`.avi` correctly route to HLS.

### Polish deferred (non-blocking)

- Multi-bitrate ladder + `-ss` seek-offset transcode; LRU **size** cap eviction (idle-kill
  is in); HW accel wiring; scrub sprite sheets (`/sprite?meta`); swap player → Vidstack.

---

## Phase 5 — Likes & collections (DONE & verified)

**Goal:** per-user favorites + manual groupings. Covers FR-31–34, FR-61.

### What exists now

- **Schema + migration `0005_social`:** `likes`, `collections`, `collection_items`.
- **Likes** (`routes/likes.ts`): `PUT/DELETE /api/media/:id/like` → `{liked, likeCount}` (idempotent).
- **`GET /api/media` real like data:** per-card `likeCount` + per-user `liked` (correlated
  subqueries replacing the Phase-3 stubs); new `liked=true` and `collection=<id>` filters;
  `sort=popularity` now orders by aggregate like count. Detail endpoint likewise.
- **Collections** (`routes/collections.ts`): owner-scoped CRUD; items add (append) / remove /
  **reorder** (`PATCH …/items {order}`); cover. `owned()` enforces FR-61 (404 on others').
- **Web:** `LikeButton` on cards + detail; header nav (Library / Liked / Collections); "Most
  liked" sort; `CollectionsPage` (list/create/delete, open via `/?collection=<id>`).
- **Shared:** like/collection DTOs + requests; `mediaQuerySchema` gains `liked`/`collection`.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 69/69** (+7 social: like idempotency,
  per-user isolation w/ aggregate counts, liked filter, popularity sort, unlike, collections
  CRUD + reorder, collection isolation).
- **Live built server:** like → `{liked:true,likeCount:1}`; `?liked=true` → 1; popularity sort
  reflects likes; add-to-collection `204`; `?collection=` → 1; `GET /api/collections` shows
  `itemCount:1`.

### Deferred (non-blocking — ADR 0008)

- Collection drag-reorder UI (API exists + tested); open-collection-in-gallery (Phase 6);
  cover-picker UI.

---

## Phase 6 — Images gallery (DONE & verified)

**Goal:** immersive left/right photo + short-video browsing. Covers FR-35–39, NFR-08.

### What exists now

- **`GET /api/media/:id/raw`** (`routes/media.ts`, images only): original bytes, or a
  `?w=`-resized JPEG variant (clamped 64–3840) generated on demand via injectable
  `ImageVariantMaker` (`services/images.ts`), cached at `data/thumbs/<id>/w<W>.jpg`
  (`immutable`), path-guarded by `resolveWithinRoot`. New `imageVariant` dep in `buildApp`.
- **`<GalleryViewer>`** (`components/GalleryViewer.tsx`): full-screen overlay over the
  caller's current `MediaCard[]` + start index; unified pointer handler = tap zones
  (prev/toggle/next) + swipe (horizontal nav, down close) without double-fire; keyboard
  ←/→/Esc/space; ±1 neighbor preload; slideshow; `n / total` indicator; short videos
  autoplay muted+loop (off under reduced-motion). Launched from Browse image cards.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 73/73** (+4 gallery: original bytes,
  width variant + immutable cache, video-rejection 404, auth).
- **Live built server, real ffmpeg:** `/raw` → 1000×800 original (43.7 kB); `/raw?w=320` →
  a real **320×256** JPEG (10.8 kB).

### Deferred (non-blocking — ADR 0009)

- Gallery windowing past the loaded result page (10k-photo sequences); pinch-zoom +
  original-on-zoom; **browser pass** of the overlay (builds + typechecks but not yet driven
  in a browser — do this with the player's pending manual pass).

---

## Phase 7 — Clips & loops (DONE & verified)

**Goal:** build looping clips, optionally export. Covers FR-40–44.

### What exists now

- **Schema + migration `0006_clips`** (`source_item_id` SET NULL → orphan, CHECK end>start).
- **Clip CRUD** (`routes/clips.ts`, owner-scoped) with range validation (`end>start`,
  ≤600 s); **virtual-loop preview** descriptor (`GET /api/clips/:id/preview`, no render);
  **export** (`POST /export` → `clip_export` job via injectable `ClipExporter`, MP4/GIF →
  `data/exports/`, `job:{id}` events) + `GET /export` status + `GET /download`. Orphaned
  clips reject new exports (409) but keep an existing export (FR-44).
- **Web:** `ClipBuilder` (`/clips/new?source=`, set-in/out + live loop preview + save),
  `/clips` grid of `ClipCard`s (virtual-loop while visible via IntersectionObserver,
  export/download/delete), "✂ Make a clip" on video detail, Clips nav link.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 81/81** (+8 clips: create + range
  validation, list/read/patch, preview, export job + download, per-user isolation, orphan
  keeps export, auth).
- **Live built server, real ffmpeg:** create clip [1.0–2.5] → preview → export → a real MP4
  of duration **1.533 s** (matching the range), downloaded as `video/mp4`.

### Deferred (non-blocking — ADR 0010)

- Frame-step precision + clip poster at the in-point (uses source poster now); GIF export
  not live-smoked (command implemented; MP4 verified); browser pass of builder/grid.

---

## Phase 8 — Branding (DONE & verified)

**Goal:** owner-driven name/logo/colors/fonts, applied live (no rebuild). Covers FR-45–48.

### What exists now

- **`settings` table** (migration `0007_settings`) + `services/branding.ts` (get/set,
  zod-validated, default fallback). **Public `GET /api/branding`**; admin `PUT
  /api/admin/branding` (deep-merges colors/fonts); asset upload
  `POST /api/admin/branding/asset?kind=logo|favicon` (`@fastify/multipart`, 2 MB,
  type-allowlist, **SVG-sanitized** via `lib/sanitize-svg.ts`) → `data/branding/`;
  `GET /api/branding/asset/:kind`. Shared branding schema + presets + `DEFAULT_BRANDING`.
- **Web:** `ThemeProvider` applies `--brand-color`/title/favicon at runtime; `BrandingPage`
  (`/settings/branding`, admin) = name + presets + color pickers + mode + logo/favicon
  upload + Save/Reset with live preview; header logo/name + login card read branding.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 87/87** (+6 branding: SVG sanitizer,
  public default GET, admin deep-merge PUT, invalid-color 422, admin-only authz, persistence).
- **Live built server:** public default GET; PUT name+primary reflected; **SVG logo uploaded
  + served sanitized** (no `<script>`/`onload`, `<rect>` kept); bad type → 422; `logoUrl` set.

### Deferred (non-blocking — ADR 0011)

- Only `--brand-color` is wired into components (most use hardcoded `neutral-*`); a semantic-
  token pass would make background/surface/text/mode live too. Font upload not applied; PWA
  manifest from branding; browser pass of the editor.

## Phase 9 — Custom commands & automation (DONE & verified)

**Goal:** admins register CLI commands; permitted users run them from forms with live
output — safely. Covers FR-49–57, NFR-06, security §5.

### What exists now

- **Schema + migration `0008_commands`:** `commands`/`command_params`/`command_runs`.
- **Security core (heavily tested):** `lib/argv-builder.ts` (no-shell token→argv),
  `lib/validate-command-args.ts` (type/constraint validation + repo_path via
  `resolveWithinRoot`), `services/command-runner.ts` (spawn shell:false, **env allowlist**,
  **cwd jail**, timeout SIGTERM→SIGKILL + process-group kill, **output cap**, cancel; streams
  to EventHub `run:{runId}`). Executable allowlist via `COMMAND_ALLOWED_EXECUTABLES`.
- **Routes** (`routes/commands.ts`): admin CRUD `/api/admin/commands`; `GET /api/commands`
  (permitted), `POST /api/commands/:id/run` (re-validates → argv → `command_run` job),
  `GET /api/command-runs[/:id]`, `POST /api/command-runs/:id/cancel`. Authz: admin always,
  else `allow_non_admin` AND `can_run_commands`; runs per-user.
- **Web:** `/commands` page renders a typed form from the param schema, runs, and polls the
  run for output/status/cancel.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 100/100**. Security coverage:
  argv injection-inert + repo_path escape (`commands-core`, 5); **real-`node`-spawn** suite
  (`commands`, 8): metacharacters verbatim/no-shell, **secret env NOT inherited**, non-zero
  exit→failed, **output cap+truncated**, **timeout kills**, **cancel kills**, non-allowlisted
  exe 422, non-admin 403. Live built-server: create + run confirmed.

### Deferred (non-blocking — ADR 0012)

- Admin CommandEditor UI (arg_template builder) + repo path **picker**; **internal** commands
  (rescan/rebuild-thumbnails/clear-cache via `is_internal`); per-command concurrency cap;
  RunConsole over WebSocket (polling now); OS resource limits. Non-root container USER is a
  Phase-10 deploy item.

---

## Phase 10 — Hardening, deploy, polish (CORE done & verified)

**Goal:** production-ready self-host. Covers NFR-01–12 + security §9 checklist.

### What exists now

- **Security headers** — `@fastify/helmet` (strict **CSP**, **HSTS**, nosniff,
  frame-ancestors none, Referrer-Policy) + `trustProxy` (config `TRUST_PROXY`). app.ts.
- **Admin System panel** (`routes/admin/system.ts`): `GET /api/admin/system` (versions,
  uptime, repo status+counts, cache sizes, queue depth), `GET /api/admin/jobs?status=`,
  `POST /api/admin/cache/transcode/clear`. Web `/settings/system` page.
- **Deploy:** non-root `USER node` Dockerfile; `docker-compose.yml` with the **Tailscale
  Serve** sidecar (shared net ns, `config/tailscale/serve.json`); `docker-compose.gpu.yml`
  NVENC override. Backup = copy `data/` (one SQLite db + branding). `.env.example` updated.

### ✅ Verification — green (2026-06-21)

- `pnpm -r typecheck/build` ✅ · `pnpm -r test` ✅ **api 104/104** (+4 system: headers,
  system shape, jobs+cache-clear, admin-only).
- **Live production-mode server:** full CSP+HSTS+nosniff on `/api/*` and the static SPA
  (renders under CSP); `/api/admin/system` with **real ffmpeg version**; cache-clear 200.
- **Security §9 checklist: all green** (see ADR 0013) — auth, sessions, path resolver,
  command sandbox, repo_path escape, secrets-not-logged, CSP, per-user isolation.

### Deferred polish (does NOT block v1 functionality — ADR 0013)

PWA service worker + manifest-from-branding; accessibility pass; **Playwright e2e**;
per-command concurrency cap; transcode cache **size**-cap eviction; the admin CommandEditor
UI; and the **browser passes** for the player / gallery / branding / commands UIs (all build
+ typecheck; none driven in a real browser this build).

## 🎉 Build plan complete — v1 feature-complete

All 11 phases (0–10) are done. Free-WAN scans multi-drive libraries (live watcher),
auto-categorizes, full-text searches, plays any video (direct + HLS) with captions/speed/
resume, supports likes/collections, a photo gallery, looping clips (+ export), runtime
branding, sandboxed custom commands, and a hardened Tailscale deploy. **104 api tests + a
shared schema test, all green; every phase verified with a live built-server smoke.**

### Post-v1 progress

- **2026-07-14 — Transcode quality caps; multi-bitrate ladder DECLINED (0.6.1).** New
  `TRANSCODE_MAX_HEIGHT` (0 = source) and `TRANSCODE_MAXRATE_MBPS` (default 6) envs feed a
  `TranscodeQuality` into `createTranscodeStarter`; `buildHlsArgs` is exported + unit-tested
  (default = no scale filter; capped = `scale=-2:'min(ih,H)'` so it never upscales, bufsize
  = 2×maxrate). **Ladder rationale:** per-viewer N× encode cost on a CPU-only home server is
  the wrong default; a slow remote link tunes the caps instead. Revisit only with HW-accel
  on a GPU host. **This closes the last buildable backlog item — everything remaining needs
  the owner** (Docker smoke, Tailscale §8 walkthrough, phone pinch-zoom pass, GPU wiring).
  Suite: **186 unit (173 api) + 18 e2e, all green.**
- **2026-07-14 — Gallery pinch-zoom (0.6.1).** GalleryViewer (images only): pinch (pointer-
  map two-finger tracking, 1–4× clamped, midpoint-anchored), double-tap/double-click toggles
  1↔2.5× anchored at the tap (image taps now run on a 280 ms delay so the second tap can
  become a zoom — videos keep instant taps), drag-to-pan while zoomed (swipe/tap-nav
  suspended; a no-move tap while zoomed still double-taps out or toggles chrome), zoom resets
  on item change, `touch-action:none` on the overlay. Double-tap path covered by e2e (gallery
  flow asserts scale 2.5 → 1); the two-finger pinch itself is math-shared with double-tap but
  needs a touch device for a hands-on pass — owner: try it on the phone. Closes the last
  Phase 6 polish item. Suite: **184 unit + 18 e2e, green ×2.**
- **2026-07-14 — Virtualized Browse grid (0.6.1).** `@tanstack/react-virtual@3.14.6`
  (`useWindowVirtualizer`, row-chunked: `useGridColumns()` mirrors the old
  2/3/4/5/6-column tailwind breakpoints; heights measured via `measureElement`). Only
  visible rows + 4 overscan are mounted; infinite-scroll sentinel, gallery index mapping,
  autoplay previews, and the a11y audits all unchanged/passing. New e2e `virt.spec.ts`
  (120-copy JPEG fixture): scroll loads every page, the bottom-most item mounts, and the
  card DOM stays <80 nodes. **Gotchas hit:** e2e assertions that assumed every card is in
  the DOM had to target the visible window or navigate by id; `titleFromFilename` turns
  underscores into spaces (`bulk_001` → "bulk 001"); the hidden preview tab suspends
  IntersectionObserver (misleading during manual verification — use Playwright). Closes the
  Phase 3 "virtualized grid" deferral. Suite: **184 unit + 18 e2e, green ×2.**
- **2026-07-14 — RunConsole over WebSocket (0.6.1).** New `web/src/lib/ws.ts`
  (`subscribeTopic` — one cookie-authed socket per subscription to `/api/ws`); the Commands
  `Runner` subscribes to `run:{runId}`, appends `run.output` chunks live, and invalidates the
  run query on the final `run.status` (the 800 ms poll stays as fallback — also covers
  internal commands that finish before the socket opens). `runInternalCommand` now publishes
  the final `run.status` for parity. Closes the Phase 9 "RunConsole over WebSocket" deferral.
  Verified: EventHub→WS pipe driven live via a node ws client against the dev API (subscribe →
  scan → 3 events), plus the real UI in the preview browser (run → streamed output pane →
  `succeeded · exit 0`, zero console errors); full suite re-run green (184 unit + 17 e2e).
- **2026-07-14 — Per-command concurrency cap (0.6.1).** Migration
  `0013_command_concurrency` adds `commands.max_concurrent` (default 1); `POST
  /api/commands/:id/run` counts queued+running runs for the command (all users) and 409s at
  the cap; freed on completion/cancel. Editor gains a "Max concurrent runs" field
  (1–16, zod-capped); internal commands stay at 1 (their PATCH guard already blocks it).
  Closes the Phase 9 "per-command concurrency cap" deferral. 2 new tests (default cap 409 +
  free-on-cancel; cap 2 admits two, rejects the third). Suite: **184 unit (171 api) + 17
  e2e, green.**
- **2026-07-14 — Internal (built-in) commands (0.6.1).** `lib/internal-commands.ts` seeds
  three `is_internal` rows at boot (idempotent): `internal:rescan` (incremental scan per
  enabled repo), `internal:rebuild-thumbnails` (queue posters for active items with none),
  `internal:clear-transcode-cache`. The `command_run` worker dispatches internal executables
  in-process (no spawn) but records the run row (status/output/exitCode) identically, so the
  Commands UI needs zero changes. `internal:` executables can never be created via the admin
  API (not in the allowlist); PATCH on built-ins allows only `enabled`/`allowNonAdmin`,
  DELETE 422s. Closes the Phase 9 "internal commands" deferral. 6 new tests
  (`test/internal-commands.test.ts`); the e2e commands flow now selects its command
  explicitly since built-ins share the list. Suite: **182 unit (169 api) + 17 e2e, green.**
- **2026-07-14 — Transcode cache size-cap eviction (0.6.1).** `TranscodeManager` now
  LRU-evicts the on-disk HLS cache past `TRANSCODE_CACHE_MAX_MB` (default 2048; 0 disables):
  the periodic sweep walks `data/hls/*`, skips in-flight transcodes, and removes
  least-recently-used completed ones until under the cap. Recency = the playlist's mtime,
  bumped on every cache reuse in `ensure()` (so rewatched items stay). `enforceCacheCap()`
  is public for tests. Closes the Phase 4/10 "size-cap eviction" deferral (idle-kill already
  existed). 2 new tests (oldest-first eviction; active spared + reuse bumps recency). Suite:
  **176 unit (163 api) + 17 e2e, all green.**
- **2026-07-14 — Accessibility pass (0.6.1) — WCAG A/AA clean.** `e2e/z-a11y.spec.ts`
  (`@axe-core/playwright@4.12.1`, z-named to run last with real content) audits login /
  Browse / watch / clips / commands / all four admin pages and asserts **zero** wcag2a+aa
  violations. Fixes: `--fw-muted` mix 52%→62% (AA on bg *and* surface); new derived
  `--fw-primary-strong` token (60% primary→text) for text-on-tint (active chips, dropzone
  labels, font-picker active, System "Manage" link); default midnight primary `#7c5cff`→
  `#6e4cff` (white button text was 4.36:1); Browse cards restructured (full-card overlay
  BUTTON as a *sibling* of the z-10 LikeButton — `role="button"` containers with interactive
  children are invalid; e2e now clicks `Open <title>`); aria-labels on the Browse selects,
  the radius slider, and the logo-only home link. Also raised `LOGIN_RATE_MAX` in the e2e
  env (per-test logins tripped the per-IP limit). Suite: **174 unit + 17 e2e, all green**;
  tokens verified live in the dev preview.
- **2026-07-14 — E2E: branding editor + commands UI (11 flows) → ALL browser passes done.**
  `e2e/settings.spec.ts`: rename the site in the Branding studio → Save → document retitles
  live + `/api/branding` and the PWA manifest reflect it; create a real `node` command in the
  admin CommandEditor (executable select from the allowlist via
  `COMMAND_ALLOWED_EXECUTABLES=node` in the e2e env, JSON arg template) → run it from
  `/commands` → live output streams `e2e-hello` → status `succeeded`. With this, **every
  deferred "browser pass" (player / gallery / clips / branding / commands) is covered by
  e2e.** Suite: **173 unit/integration + 11 e2e**, all green (two consecutive runs).
- **2026-07-14 — E2E extended to playback, clips, and the gallery (9 flows).**
  `e2e/media.spec.ts` (+ shared `e2e/helpers.ts`, a 3 s h264 `ocean.mp4` fixture generated in
  `start-server.mjs`): video library scanned via API with the browser session → card in
  Browse; the watch page **direct-plays** (asserts `currentTime` advances, with
  `--autoplay-policy=no-user-gesture-required` in test launch args); ClipBuilder set-in →
  seek → set-out → save → clip card in `/clips`; photo card opens the GalleryViewer overlay
  and Escape closes it. This clears the deferred **browser passes for the player, gallery,
  and clips** (Phases 4/6/7). Still browser-unverified: branding editor, commands UI —
  next e2e targets. Suite: **173 unit/integration + 9 e2e**, all green (two consecutive runs).
- **2026-07-14 — Playwright e2e suite (the top polish item).** Root `playwright.config.ts` +
  `e2e/core.spec.ts` drive the REAL built app (`node packages/api/dist/index.js` serving
  `web/dist`) in headless Chromium on `:8199` with an isolated `e2e/.data`. **5 serial flows:**
  unauthenticated redirect → login; bootstrap login → forced password change → app; old
  password rejected; admin adds a library via the UI → Scan → item appears in Browse (real
  ffmpeg-generated JPEG fixture); branded manifest served. Run: `pnpm -r build && pnpm
  test:e2e` (dep `@playwright/test@1.61.1` pinned at the root; CI installs ffmpeg + chromium
  and runs it after the unit suite). Gotcha encoded in the config: Playwright launches
  `webServer` BEFORE `globalSetup`, so the per-run state wipe lives in `e2e/start-server.mjs`
  (the webServer command itself), not in a globalSetup hook.
- **2026-07-14 — PWA install manifest from branding (0.6.1).** Public
  `GET /api/manifest.webmanifest` (routes/branding.ts) builds name/short_name/colors from the
  live branding (`scope:'/'` set explicitly — manifests, unlike service workers, may widen
  scope past their URL directory, and /api keeps the dev proxy + SPA fallback happy) plus
  `GET /api/branding/pwa-icon`: the uploaded logo when it's an SVG, else a generated monogram
  (site initial on brand primary, luminance-picked text color). `index.html` links the
  manifest; ThemeProvider now also retunes `<meta name="theme-color">`. **Service worker
  deliberately skipped**: Chromium no longer requires one for install, and a SW cache would
  fight the self-update flow (no-cache index.html + immutable hashed assets is already the
  right caching story). 2 new api tests (manifest reflects branding PUT; monogram → uploaded-
  SVG switch) + live browser check (manifest fetch, icon, meta). Suite now **173 tests**
  (api 160 + web 11 + shared 2).
- **2026-07-14 — First-run repository seeding (0.6.1).** `config/repositories.yaml` is now
  honored: on boot with an **empty** repositories table (and no prior attempt recorded),
  `lib/seed-repositories.ts` creates each listed entry (zod-validated: name/path required,
  `type` defaults `mixed`, `readOnly`/`enabled` default true), skips non-existent paths with a
  warning, queues an initial scan per enabled repo, and kicks the worker. One-shot semantics:
  an `app_meta` `repositories_seeded` flag records the attempt so UI deletions are never
  resurrected. New pinned dep `yaml@2.9.0`; `REPOSITORIES_FILE` env (default resolved in
  buildApp to `<repoRoot>/config/repositories.yaml` because the server cwd is `packages/api`).
  3 new tests (`test/seed.test.ts`: seed+skip+auto-scan, once-per-data-dir across restart,
  missing/malformed file tolerated) + a live tsx-server smoke (seed log, watcher attach,
  auto-scan → itemCount 1). Suite now **170 tests** (api 157 + web 11 + shared 2).
- **2026-07-14 — Case-insensitive categories (0.6.1).** Migration `0012_categories_nocase`
  merges pre-existing case-duplicate categories per repo (links deduped via INSERT OR IGNORE,
  children reparented, counts recomputed, first-seen row kept) and recreates
  `idx_categories_repo_path` as `(repository_id, path COLLATE NOCASE)`; the scanner's
  chain-upsert lookup now compares `COLLATE NOCASE`, so `Action/` and `action/` resolve to one
  category with the first-seen display name. Covered by a new scanner test (case-variant folder
  reuses an existing node — simulated at the DB layer since Windows/macOS filesystems can't
  hold both spellings); the migration's merge path was verified against a simulated pre-0012
  DB (dup+child+cross-repo cases). Suite now **167 tests** (api 154 + web 11 + shared 2).
- **2026-06-21 — Web component tests added.** `packages/web` now has a Vitest + happy-dom +
  Testing Library setup with **11 tests** (format helpers, API client, `LikeButton` PUT/DELETE,
  `GalleryViewer` keyboard nav + Escape). Full suite is now **117 tests** (shared 2, web 11,
  api 104); CI runs all three. Closes the long-standing "web has no tests" gap. See ADR 0014.

### A next agent could pick up (post-v1)

1. ~~The deferred polish~~ — **all landed 2026-07-14**: Playwright e2e (17 flows incl.
   playback/gallery/clips/branding/commands), the a11y pass (axe WCAG A/AA clean), and the
   PWA manifest (service worker deliberately skipped — see the post-v1 log).
2. **Carried-over refinements** — mostly resolved or intentionally closed (2026-07-14):
   - **Keyset pagination: DECLINED.** SQLite offset pagination walks the sorted index and
     stays fast at personal-library scale; converting all five sort modes (incl. the
     aggregate popularity sort and collection position) to composite keyset comparisons adds
     real bug surface for marginal gain. Revisit only if profiling shows offset cost at
     >100k items.
   - **HW-accel transcode wiring: NEEDS REAL HARDWARE.** `docker-compose.gpu.yml` exists;
     wiring/verifying NVENC flags requires a GPU host — owner task.
   - Still genuinely open: multi-bitrate HLS ladder (single capped 6 Mbps rendition today —
     fine on a tailnet, matters for slow remote links); virtualized Browse grid (DOM grows
     with infinite scroll — matters past a few thousand loaded cards); scrub sprite sheets
     (the `/frame?t=` grabber covers hover-scrub today); gallery pinch-zoom.
   - Done earlier: CommandEditor (0.5.0), internal commands + concurrency cap + WS RunConsole
     (0.6.1), semantic tokens (the `--fw-*` design system), case-insensitive categories +
     YAML repo seeding (0.6.1).
3. **Run the §8 acceptance walkthrough** end-to-end on real hardware over Tailscale, and a
   `docker compose up --build` smoke. (Attempted 2026-07-14: Docker Desktop is installed on
   the build machine but its engine did not come up headlessly — likely needs an interactive
   first-run/update step. Owner task: open Docker Desktop once, then `docker compose up
   --build` and check `GET /api/health`.)

**First steps for any continuation:** `pnpm install`, then `pnpm -r test` (api should be 104/104).

## Handoff log

- **2026-06-21 — Phase 0 scaffold authored AND verified. ✅** Full monorepo file tree
  created (root config, shared/api/web packages, Dockerfile, compose, CI). Fastify
  `/api/health` + shared zod contract + Drizzle/SQLite migrator + React hello page.
  Verified green: install, `-r typecheck`, `-r test` (shared 2/2, api 2/2), `-r build`,
  and a live built server (health ok, static web served, SPA fallback, api 404 envelope).
  Only fix needed during verification: typed the Fastify logger as `FastifyBaseLogger`,
  queried the migration check via Drizzle instead of `$client`, added `--passWithNoTests`
  to web, and fetched the `better-sqlite3` prebuilt binary (see native-module gotcha).
  ADR 0001 records tooling decisions. **Next agent: start Phase 1.**
- **2026-06-21 — Phase 1 auth & users built AND verified. ✅** Added users/sessions schema +
  migration `0001_auth`, Argon2id (hash-wasm), opaque signed-cookie sessions, deny-by-default
  authn/authz middleware, login rate-limiting, first-run admin bootstrap with forced password
  change, and admin user CRUD with last-admin protection. Shared zod auth contracts. Web:
  TanStack Query + React Router, API client, login + forced-change pages, route guard, home.
  Verified green: typecheck, build, `pnpm -r test` (api **15/15**), and a live curl flow
  including the full authz matrix and non-admin 403. Decisions in ADR 0002; `must_change_password`
  divergence documented in `docs/03-data-model.md`. **Next agent: start Phase 2 (scanning).**
- **2026-06-21 — Phase 2 indexing core built AND verified. 🟡** Added repositories/media_items/
  categories/media_categories/subtitle_tracks/jobs schema + migration `0002_media`; pure
  classification/categorization/playback/ffprobe-mapping modules; an in-process job worker;
  the scanner (incremental walk, ffprobe upsert via injectable prober, folder→category
  derivation with counts+prune, sidecar+embedded subtitles, missing/offline sweep); and
  repository CRUD + scan endpoints. Shared repository contracts. Verified green: typecheck,
  build, `pnpm -r test` (api **34/34**), and a live built-server scan with **real ffprobe**
  over ffmpeg-generated media (found/indexed 2). Decisions in ADR 0003. **Remaining before
  Phase 3 acceptance: chokidar watcher, scheduled rescan, WebSocket scan progress (FR-13/14).
  Next agent: finish those, then start Phase 3 (discovery & thumbnails).**
- **2026-06-21 — Phase 2 COMPLETED. ✅** Added the realtime layer (`EventHub` + `@fastify/websocket`
  at `/api/ws`, cookie-authed, topic allowlist; scan progress published to `scan:{repoId}`),
  the `chokidar` `WatcherManager` (repo-level debounced incremental rescan, synced on
  repo CRUD, off under tests), and a scheduled full-rescan backstop. Exported `resolveSession`
  for WS auth. Verified green: typecheck, build, `pnpm -r test` (api **39/39**, incl. WS
  auth-reject + subscribe/forward), and a **live watcher smoke** (new file auto-indexed, no
  restart — FR-13). Decisions in ADR 0004. Minor non-blocking deferrals: YAML repo seeding,
  case-insensitive categories. **Next agent: start Phase 3 (discovery & thumbnails).**
- **2026-06-21 — Phase 3 discovery & thumbnails DONE. ✅** Added FTS5 (`media_fts` + migration
  `0003_fts`, populated by the scanner), `GET /api/media` (filter/sort/cursor-paginate, nested
  category filter, FTS search), media detail, `GET /api/categories[/:id]`, an injectable
  thumbnailer + `thumbnail` job + poster endpoint, and a Browse + Detail web UI (URL-as-state).
  Shared discovery DTOs. Verified green: typecheck, build, `pnpm -r test` (api **47/47**), and a
  live built-server smoke with **real ffmpeg** (search, detail, and a real 480×270 JPEG poster).
  Decisions in ADR 0005. Deferred (non-blocking): sprites/`/raw?w=` variants (Phase 4/6),
  virtualized grid, keyset pagination, likes/popularity (Phase 5). **Next agent: start Phase 4
  (video playback).**
- **2026-06-21 — Phase 4 video playback (direct-play) built AND verified. 🟡** Added the
  path-safety resolver, ranged `/stream`, `/playback` decision (cached `playback_mode`),
  WebVTT captions (injectable converter), `playback_progress` + resume/watched (migration
  `0004_playback`), and a native `<video>` player (isolated for a Vidstack swap) with a
  `/watch/:id` route. Verified green: typecheck, build, `pnpm -r test` (api **55/55**), and a
  live real-mp4 smoke (206 ranged stream, resumeAt). Decisions in ADR 0006. **Remaining
  before Phase 5: on-the-fly HLS transcode, scrub sprites, Vidstack swap. Next agent: finish
  HLS or start Phase 5 (likes & collections) — both are viable.**
- **2026-06-21 — Phase 4 COMPLETED (HLS transcode). ✅** Added the single-flight
  `TranscodeManager` (injectable ffmpeg starter, cached/idle-swept), `GET /hls/master.m3u8`
  + `/hls/:file` routes (validated, no traversal), and hls.js playback in the web player.
  Fixed a real decision bug found via live smoke: `decidePlaybackMode` now keys the container
  on file extension, so `.mkv`/`.avi` correctly transcode. Verified green: typecheck, build,
  `pnpm -r test` (api **62/62**), and a **live real-ffmpeg HLS smoke** (an `.mkv` → `mode:hls`
  → complete `#EXT-X-ENDLIST` playlist + a 79.9 kB `.ts` segment). Decisions in ADR 0007.
  **Next agent: start Phase 5 (likes & collections).**
- **2026-06-21 — Phase 5 likes & collections DONE. ✅** Added `likes`/`collections`/
  `collection_items` (migration `0005_social`); like toggle endpoints; real per-card
  `likeCount`/`liked` + `liked`/`collection` filters + popularity sort in `GET /api/media`
  (replacing the stubs); owner-scoped collections CRUD + reorder; web like buttons + Liked
  nav + Collections page. Verified green: typecheck, build, `pnpm -r test` (api **69/69**),
  and a live smoke (like count, liked filter, popularity, collection view). Decisions in ADR
  0008. **Next agent: start Phase 6 (images gallery + `/raw?w=` variants).**
- **2026-06-21 — Phase 6 images gallery DONE. ✅** Added `GET /api/media/:id/raw` (original +
  `?w=` resized variants via an injectable ffmpeg resizer, cached + path-guarded) and a
  full-screen `<GalleryViewer>` (tap zones + swipe + keyboard, slideshow, ±1 preload,
  position indicator, reduced-motion, muted-loop short videos), launched from Browse image
  cards. Verified green: typecheck, build, `pnpm -r test` (api **73/73**), and a live
  real-ffmpeg smoke (`/raw?w=320` → a true 320×256 JPEG). Decisions in ADR 0009. Overlay's
  browser pass still pending. **Next agent: start Phase 7 (clips & loops).**
- **2026-06-21 — Phase 7 clips & loops DONE. ✅** Added `clips` schema (migration `0006_clips`,
  source SET NULL for orphaning), owner-scoped CRUD + range validation, virtual-loop preview,
  the `clip_export` ffmpeg job (injectable, MP4/GIF) + status/download, and orphan handling;
  web `ClipBuilder` + `/clips` grid of auto-looping cards + "Make a clip". Verified green:
  typecheck, build, `pnpm -r test` (api **81/81**), and a live real-ffmpeg smoke (clip
  exported to a real 1.533 s MP4). Decisions in ADR 0010. **Next agent: start Phase 8
  (branding) — note the `settings` table doesn't exist yet; add it.**
- **2026-06-21 — Phase 8 branding DONE. ✅** Added the `settings` table (migration
  `0007_settings`), public `GET /api/branding`, admin PUT (deep-merge), SVG-sanitized asset
  upload (`@fastify/multipart`) + serving, and web `ThemeProvider` (runtime `--brand-color`/
  title/favicon) + `BrandingPage` editor (presets, color pickers, logo/favicon upload, live
  preview). Verified green: typecheck, build, `pnpm -r test` (api **87/87**), and a live smoke
  (PUT reflected; SVG logo uploaded + served **sanitized**; bad type 422). Decisions in ADR
  0011. **Next agent: start Phase 9 (custom commands) — read `docs/13-security.md` §5; it is
  the sharpest security edge (no-shell, cwd jail, env allowlist, timeouts, non-root).**
- **2026-06-21 — Phase 9 custom commands DONE. ✅** Added the commands schema (migration
  `0008_commands`), the **no-shell argv builder**, server-side arg validation (incl.
  `repo_path` via `resolveWithinRoot`), and the **sandboxed runner** (spawn shell:false, env
  allowlist, cwd jail, timeout SIGTERM→SIGKILL, output cap, cancel, EventHub streaming) +
  executable allowlist + run endpoints + a `/commands` run UI. Verified green: typecheck,
  build, `pnpm -r test` (api **100/100**, incl. an 8-test real-`node`-spawn suite proving
  no-shell/injection-inert, env-not-inherited, output-cap, timeout, and cancel). Decisions in
  ADR 0012. **Next agent: start Phase 10 (hardening, Tailscale deploy, admin System panel,
  CSP/headers, non-root container) — the final phase to v1.**
- **2026-06-21 — Phase 10 hardening & deploy DONE → v1 FEATURE-COMPLETE. 🎉** Added
  `@fastify/helmet` (CSP/HSTS/headers) + `trustProxy`, the admin System panel
  (`/api/admin/system` + jobs + transcode-cache clear), a non-root `USER node` Dockerfile, the
  Tailscale Serve sidecar + `docker-compose.gpu.yml`, and backup docs. Verified green:
  typecheck, build, `pnpm -r test` (api **104/104**), and a live production-mode smoke
  (full CSP+HSTS on API + SPA, real-ffmpeg System panel). The security §9 checklist is all
  green. Decisions in ADR 0013. **All 11 build-plan phases complete.** Remaining is polish
  (PWA, a11y, Playwright e2e, browser passes) — see PROGRESS "post-v1".
- **2026-06-21 — Post-v1: web component tests added. ✅** Stood up Vitest + happy-dom +
  Testing Library in `packages/web` and wrote 11 tests (helpers, API client, LikeButton,
  GalleryViewer). Verified green: typecheck 3/3, build, `pnpm -r test` now **117** (web 11 +
  api 104 + shared 2). Decisions in ADR 0014. **Next agent: Playwright e2e is the top
  remaining polish item; then PWA + accessibility.**
- **2026-08-23 — Native mobile app built; verified as far as a browser can reach.** Added
  `packages/mobile`, an Expo/React Native client (SDK 54) over the same API, sharing types
  through `@free-wan/shared`. Browse with search, folder drill-down, tag filters (AND-combined),
  liked-only and video/photo toggles; collections and clips read-only; detail with playback,
  likes and tags; offline downloads of video and photos with progress, failure-with-retry, and
  pruning of files the OS reclaims; forced password change; and error states that say the
  server is unreachable rather than showing an empty library. Server side, `resolveSession`
  now also accepts `Authorization: Bearer` — the app cannot use a cookie, because
  `expo-file-system` and `expo-video` request outside the JS layer — returned only to a
  `client: "native"` login, which sets no cookie. Verified green: typecheck 4/4,
  `pnpm -r test` **228** (api 180 + mobile 35 + web 11 + shared 2), `pnpm -r build` (which now
  bundles the app through Metro for both platforms — `tsc` cannot see resolution failures),
  expo-doctor 18/18, `expo prebuild`, and a live browser run of the app served same-origin from
  the API: sign-in, gate, browse, search 15→6→15, categories 15→4, tags 15→5→4, likes persisted
  server-side, collections, clips opening at their in-point. Decisions and the four departures
  from AGENTS.md in ADR 0015; usage in `docs/15-mobile-app.md`. **Not verified — needs a
  device: real playback, real file I/O, secure storage. Known gaps with reasons recorded:
  subtitles need the HLS master to advertise caption tracks (a server change), and live
  branding needs a dynamic theme through every screen. Next agent: run it on a phone via
  Expo Go before adding anything.**
- **2026-08-23 — Mobile app: three session-handling bugs found and fixed against a nested
  fixture.** Built a library with real sub-folders (`Movies/Action`, `Movies/Comedy`,
  `Photos/2024`) to close the gap flagged in `56da14c`: multi-level drill-down had never been
  exercised, because the sample library is flat. Drilling All → Movies → Action and back out
  works — the trail shows a back chip, tappable ancestor crumbs and a non-tappable current
  level, and the grid narrows at each step (4 → 3 → 2). Getting there surfaced three defects,
  each found by using the app rather than by reading it:
  (1) `clearSession` awaited `SecureStore.deleteItemAsync` unguarded, so a keychain that
  refused to delete left the token in memory, told no subscriber, and stranded the user on an
  error screen whose retry could never succeed;
  (2) TanStack Query ran with the default `networkMode: 'online'`, which pauses a retry when
  `onlineManager` believes the device is offline — and `onlineManager` was never wired to
  NetInfo, so its belief was a guess. A query paused before recording any result stays
  `pending` forever: after signing in following a 401, the folder chips never came back for
  the rest of the session, with no error and no spinner to say why. Now `networkMode:
  'always'`, in `src/lib/query.ts` (extracted from the root layout so it can be tested);
  (3) signing in did not reset the query cache the way signing out does, so queries that
  answered 401 while signed out outlived the login.
  Each fix has a regression test that was control-tested against the unfixed code: the
  keychain test rejects, and both network-mode tests hang until timeout. Verified green:
  typecheck 4/4, `pnpm -r test` **231** (api 180 + mobile 38 + web 11 + shared 2),
  `pnpm -r build`. **Still not verified — needs a device: real playback, real file I/O,
  secure storage.**
- **2026-08-23 — Mobile app: a transfer in progress can now be stopped.** The one gap the
  downloads documentation admitted to. For an app whose reason to exist is keeping video on
  the phone, starting a multi-gigabyte download with no way out is a poor bargain on a
  metered connection. `cancelDownload` stops the transfer, discards the partial file, and
  returns the item to offering Download — deliberately *not* to the failure state, since
  reporting "Download failed — tap to try again" for something the user chose to stop would
  be telling them something went wrong. Controls: a cross on the Downloads tab row, a Stop
  beside the progress bar on the item's own screen. Four tests, control-tested: dropping the
  cancel/failure distinction reports 'failed', and skipping the partial-file cleanup leaves
  the file behind. The cleanup test needed a stub that can fail a cancel midway — expo
  deletes the partial file itself on a clean cancel, so the first version of that test passed
  against deliberately broken code and proved nothing. Verified green: typecheck 4/4,
  `pnpm -r test` **235** (api 180 + mobile 42 + web 11 + shared 2), `pnpm -r build`.
  **The two cancel controls are unverified in a browser and need a device: they only appear
  while a transfer runs, and `expo-file-system` has no web implementation.**
- **2026-08-23 — Mobile app: uploading from the phone.** The app can now put photos and video
  from the device into the library — the one thing it does that the web app cannot do as
  well, since the phone is where the pictures are. This reverses part of ADR 0015 decision 5,
  and the ADR now records that: the decision ruled out uploads on the grounds that curating
  is better with a keyboard, but uploading is capture, not curating, so the reason never
  actually applied. No server change was needed; `/api/upload/targets` and
  `/api/repositories/:id/upload` already existed for the web app.
  A floating button on Browse opens the picker (up to 50 items), asks which library if more
  than one accepts uploads, and sends files one at a time at full quality with per-file
  progress. Outcomes are read from the server's own answer rather than inferred, so a
  de-duplicated name ("IMG_0001 (1).jpg") is reported as saved and a rejected file is named
  with its reason; one bad file does not abandon the rest. Four tests, control-tested — the
  naive "no skipped entry means success" version fails two of them, including the dangerous
  one where an empty 422 would have been reported as uploaded.
  Verified in the browser harness: the button renders once, clears the tab bar, is
  hit-testable, taps pass through to the grid (`box-none`), and the grid carries 84px of
  bottom clearance so the last row is never covered. Verified green: typecheck 4/4,
  `pnpm -r test` **239** (api 180 + mobile 46 + web 11 + shared 2), `pnpm -r build`,
  expo-doctor 18/18. **The picker, the which-library sheet and the transfer itself are
  unverified and need a device: `expo-image-picker` opens the platform file dialog and
  `expo-file-system`'s upload task has no web implementation.**
- **2026-08-23 — Mobile app: pagination exercised for the first time; no defects found.** The
  API pages at 40 and the sample library holds 15, so `fetchNextPage` had never once run.
  Built a 95-item library to force three pages and drove it end to end. Everything was
  already correct: the server returns 95 unique ids across 3 pages with no duplicates or
  gaps (it orders by a unique id tiebreaker, so its offset cursor is stable); the app
  accumulates them, exhausts the cursor and renders 95 tiles; changing a filter starts a
  fresh page-1 query rather than inheriting the spent cursor, and the unfiltered pages stay
  cached so clearing a search restores instantly.
  Two limits worth recording. The scroll-driven trigger could only be partly exercised — the
  harness window will not shrink to phone size, and at 3440px the grid is 15 columns wide, so
  80 tiles fit on screen and `VirtualizedList` has no scroll events left to re-evaluate. It
  advanced a page on scroll, and calling `fetchNextPage` directly completed the set, so the
  data path is proven; the gesture itself still wants a device. This is not reachable on real
  hardware: columns are `max(2, floor(width / 220))`, so 40 tiles always overflow a phone or
  tablet screen.
  Since nothing was broken, the contribution is a regression net rather than a fix.
  `mediaListQueryOptions` is now separate from the hook so the two silent failure modes can be
  tested: seven tests fail if the query key stops including the filters, and one fails if a
  null cursor is not converted to `undefined`. Verified green: typecheck 4/4, `pnpm -r test`
  **250** (api 180 + mobile 57 + web 11 + shared 2), `pnpm -r build`.
- **2026-08-23 — Mobile app: subtitles, drawn by the app.** The last functional gap, deferred
  three times as "a server change, not an app one". That framing was wrong, and ADR 0015
  decision 8 has been rewritten to say so: advertising caption tracks in the HLS master would
  have risked the web player for no benefit there, and would only have covered `hls`
  playback. The first captioned file tested came back as `mode: "direct"`, so items with no
  captions at all would have been the common case, not a corner one.
  Instead the app fetches the WebVTT, parses it and draws the active cue over the video. A
  speech-bubble button appears only when a video has tracks; one track toggles, several open
  a list with an Off entry; captions start off. Costs recorded in the ADR and the docs:
  captions are styled by the app rather than by the platform's accessibility settings, and a
  downloaded video has none offline because the track is fetched from the server.
  The parser is the risk, so it carries 20 tests: the long and short timestamp forms, comma
  decimal marks, fractions that must not be read as milliseconds, BOM and CRLF, cue
  identifiers, NOTE/STYLE/REGION blocks, inline markup and entities, cue settings after the
  end time, unsorted files, malformed blocks that must cost only themselves, and cue
  selection across gaps, boundaries and overlaps. Three control tests: reading ".5" as 5ms
  and preferring the first overlapping cue both fail as they should. The third found a bad
  test of mine — "end time is exclusive" passed against deliberately broken code, because the
  latest-wins rule masked the boundary; rewritten against a cue with nothing after it, it now
  fails properly.
  Verified in the browser against a server-served sidecar: the track is discovered and
  labelled, the button toggles and fetches the VTT, and the cue renders with `<v>` and `<i>`
  markup stripped. The button correctly stays hidden for a photo and for a video without
  captions. Verified green: typecheck 4/4, `pnpm -r test` **270** (api 180 + mobile 77 +
  web 11 + shared 2), `pnpm -r build`. **Cue changes over time are unverified: a browser
  cannot load the video at all, because a plain `<video>` element cannot carry the auth
  header `VideoSource` uses on native. Needs a device.**
- **2026-08-23 — Mobile app: branding followed; a light-preset contrast bug found and fixed.**
  The last deliberate omission. ADR 0015 decision 9 said branding was not followed because
  applying it meant threading a theme through every screen — avoidable, as it turned out:
  this package has no `StyleSheet.create` anywhere, so every style object is built during
  render, the tokens in `src/theme.ts` can be mutated in place, and keying the root makes one
  render happen. That is why ~300 `theme.` reads across 19 files did not have to change. The
  note in `theme.ts` records the condition this depends on.
  `src/lib/palette.ts` reproduces the web's `color-mix` derivations with the same percentages
  so both apps land on the same values. Doing so revealed the literals the theme used to
  carry (`#1f1f27`, `#9a9aa6`) were eyeballed and had drifted from what the web computes
  (`#23232a`, `#95959a`); they now agree.
  The old warning that half-applied branding "would look broken" was right, and applying a
  light preset proved it: the duration badge on a tile paired a hardcoded dark background
  with `theme.color.text`, which is near-black under a light preset — **contrast 1.2:1, the
  text invisible**. Now a fixed dark pill with fixed white text at 21:1, since it sits over
  arbitrary poster art and should not follow the palette. An audit of every other hardcoded
  colour found the rest correct: video letterbox, subtitle plate, modal scrims and shadows
  are all deliberately palette-independent.
  Also recorded, not worked around: the shared **`linen` preset fails WCAG AA** for muted
  text on its own background (4.41:1, needs 4.5). This is a property of the preset, not of
  this port — the web app derives muted with the same 62% mix and carries the same shortfall,
  against the intent its own comment states. A test pins the measured value and fails if the
  preset is ever retuned, which is the prompt to remove the exception.
  Verified in the browser end to end with the light `linen` preset applied and a custom site
  name: login screen branded before sign-in, palette, primary, derived border and radius all
  correct, then reverted to `midnight` and confirmed it follows back. Verified green:
  typecheck 4/4, `pnpm -r test` **297** (api 180 + mobile 104 + web 11 + shared 2),
  `pnpm -r build`.
- **2026-08-23 — Mobile app: hardening pass over the newest code; two real defects, both
  mine.** With no documented gaps left, this was a review of what the last few sessions added
  rather than new features.
  (1) **Upload filenames were derived wrongly.** The picker leaves `fileName` null often
  enough to matter, and the fallback used `uri.split('.').pop()`. That returns the *whole
  string* when there is no dot, so an Android `content://` URI produced a name like
  `upload-1.content://media/external/images/media/1234` — and because `pop()` on a non-empty
  array is never `undefined`, the `?? 'jpg'` written as the safety net could never run. A
  query string or a dot in a parent directory broke it too: three of four realistic URI shapes
  gave garbage. This is not cosmetic — the server uses the extension to decide what a file is
  whenever it cannot place the MIME type, so an ordinary photo could come back as
  "unsupported file type". Now a tested `fileNameFor`: strips query and fragment, takes the
  extension only from the last path segment and only when it looks like one, and otherwise
  falls back on the media kind. Ten tests; seven fail against the old logic.
  (2) **The caption time signal ran for every video.** `timeUpdateEventInterval` was set
  unconditionally, and its default is 0, meaning no event at all — so this turned on a
  4 Hz event, and a `setState` per tick, for every video whether or not subtitles were on.
  Each tick re-rendered the whole media screen. Now gated on a track being selected.
  Audited the same class of problem elsewhere: no other fragile string parsing outside
  `palette.ts`, which is regex-guarded and tested. Checked crash handling too and left it
  alone — expo-router's default error boundary already shows a message and a Retry rather
  than a blank screen; it does not follow branding, which is noted but not worth a custom
  screen. Captions re-verified in the browser after the gating change. Verified green:
  typecheck 4/4, `pnpm -r test` **306** (api 180 + mobile 113 + web 11 + shared 2),
  `pnpm -r build`.
- **2026-08-23 — Mobile app: the auth gate under test, and a documented security claim
  corrected.** Reviewed the piece that decides which screen you see — security-adjacent, the
  source of an earlier bug, and until now verified only by clicking through a browser.
  Checking one of its stated justifications turned up a false claim in this project's own
  docs. ADR 0015 decision 7 said the app could safely carry on when `mustChangePassword` is
  unknown "because the server enforces the rule on every request". **It does not.**
  `authenticate` and `requireAdmin` check the session and the role and nothing else; no route
  refuses a user who still holds the password they were given. The flag is reported by login
  and `/api/auth/me` and cleared on change, but it is never a gate — enforcement lives
  entirely in the two clients, and the web app is in the same position. The offline carry-on
  is still the right call, but for a different reason than the one recorded, and it is now
  written down honestly in the ADR, in `docs/15-mobile-app.md`, and in a new note under
  `docs/13-security.md` §3 that also says what making it a real boundary would take. **Not
  changed: whether the server should enforce it. That is a server-side security decision for
  the project, not for this package.**
  The gate's decision is now `gateRedirect` in `src/lib/gate.ts`, separate from the effect
  that acts on it, with nine tests. The useful one enumerates all 32 states and checks every
  destination is a fixed point — a gate that redirects somewhere which redirects again is an
  app that never settles, which is exactly the shape of the login-bounce bug from the first
  session. Three control tests: removing the not-ready guard, dropping the already-on-login
  guard, and checking the password rule before sign-in all fail, and the loop introduced by
  the second is caught by the fixed-point test on its own. Verified green: typecheck 4/4,
  `pnpm -r test` **315** (api 180 + mobile 122 + web 11 + shared 2), `pnpm -r build`.
