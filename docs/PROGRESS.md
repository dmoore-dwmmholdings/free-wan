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
- **2026-08-23 — Mobile app: a clip could be watched once and then not again.** Reviewed the
  clip player, the least-examined screen and the last one holding real timing logic. A clip
  saved without looping paused at its out-point and left the playhead there, so the next press
  of play met another pause within a quarter of a second — the sampling interval. The only way
  back was to find the in-point by hand on a scrubber spanning the whole source video. Both
  outcomes now rewind: looping keeps playing, stopping pauses at the in-point ready to go
  again.
  The decision is `clipCommandFor` in `src/lib/clips.ts`, with seven tests. The one that
  matters checks the command is a fixed point — that acting on it does not immediately produce
  another command — which is the same property that caught the redirect loop in the auth gate,
  and it catches this bug on its own without being aimed at it. Control-tested: the original
  pause-without-rewind fails two tests.
  Two things checked and deliberately left alone. `useEventListener` keeps a ref to the latest
  listener, so the handler is not reading a stale `preview.data` — a real hazard with that
  shape, but not present. And the server validates `endS > startS` on both create and update,
  so no guard against a degenerate range was added; defending against it would be error
  handling for something that cannot arrive.
  Verified in the browser as far as it reaches: the screen renders, the clip's title and Loops
  badge show, and the playhead opens at the in-point. The looping itself is unverifiable
  there, for the same reason as subtitle timing — the browser cannot load the video at all,
  since a plain `<video>` element cannot carry the auth header. Verified green: typecheck 4/4,
  `pnpm -r test` **321** (api 180 + mobile 128 + web 11 + shared 2), `pnpm -r build`.
- **2026-08-23 — Mobile app: the app/server contract is now checked, plus one small fix.**
  Two review passes had already been done, so this one was systematic rather than
  exploratory: every `/api/...` path the app asks for was compared against every route the
  server registers. **The result was clean — no path is missing.** Rather than leave that as a
  one-off, it is now `test/api-contract.test.ts`, which reads both sides and fails if a
  requested path has no route. It exists because this has gone wrong before: an early version
  called `GET /api/collections/:id`, which was never written, and nothing caught it until the
  screen 404'd. Neither `tsc` nor the stubbed-`fetch` tests can see that, because a URL is
  only a string. Control-tested twice — an invented endpoint and a one-letter typo in a real
  one both fail, naming the file that asks for it. The test also asserts both extractions
  found something, so a broken scrape cannot pass vacuously.
  One real defect found while reading `useProgressReporter`: the marker recording the last
  position sent was a bare number and outlived a change of item, so one video's position could
  suppress another's. Leaving a video at 300s and then a second at 300.5s in the same session
  dropped the second report, and with it the only record of where that video had been watched
  to. The marker is now scoped to the item.
  Also reviewed and left alone: `AuthImage` (the window where a stale poster could show is one
  microtask, since the URL and headers come from memory after the first call). Verified green:
  typecheck 4/4, `pnpm -r test` **341** (api 180 + mobile 148 + web 11 + shared 2),
  `pnpm -r build`.
- **2026-08-23 — Mobile app: the QR path itself verified, and a stale dev server replaced.**
  No source changes. Several sessions of work have asked for a device run without anyone
  checking that the dev server still worked after the SDK 54 upgrade and everything since —
  which would have wasted the tester's time rather than mine.
  It did not. An `expo start` from earlier in the day was still holding port 8081, had drifted
  to resolving from the workspace root instead of `packages/mobile`, and answered bundle
  requests with `Unable to resolve module ./index`. Worse in principle: Metro serves the
  working tree live, so during the stretches when the browser harness had `session.ts`
  patched, that server was serving patched code to anything that connected. Killed and
  replaced with a clean one.
  The replacement is verified end to end rather than assumed: the manifest reports
  `exposdk:54.0.0`, matching what the phone expects; the launch asset builds (7.2 MB, HTTP
  200) so Metro compiles the whole app; the served bundle carries no harness marker; and the
  strings for uploads, subtitles, download failure, the forced password change and offline
  playback are all present in it, so what a phone receives is this session's work. Reachable
  on both `192.168.1.211:8081` and the tailnet at `100.81.57.116:8081`.
  Also checked and deliberately not changed: the Settings storage total sums media bytes but
  not cached posters, so it understates — by a few hundred KB against multi-gigabyte video,
  which is not worth the churn to fix.
  **The dev server is left running for a device test.** Documented the stale-server trap under
  Troubleshooting, since Metro serving live source is exactly what makes it confusing.
- **2026-08-23 — Mobile app: native chrome follows the brand; icons and identity checked.**
  Reviewed what the app looks like as an installed thing rather than as code. Icons are real
  and correctly formed — 1024×1024, with `icon.png` deliberately carrying no alpha channel
  (iOS rejects it) while the Android adaptive foreground does, and the mark sits inside
  Android's centre safe zone. Identity is right too: home-screen name "FreeWAN", sensible
  bundle ids, and `orientation: default` so video can be turned sideways.
  One leftover from before branding existed: `userInterfaceStyle` was pinned to `dark`. That
  governs the platform's own chrome — keyboard, system dialogs, action sheets, text-selection
  handles — none of which take their look from the app's tokens. Since the app now retunes to
  light presets, a `paper` or `linen` server would have produced a dark keyboard and a dark
  alert over a cream screen: exactly the half-applied look that following branding was meant
  to remove, and the same family as the invisible duration badge found when branding went in.
  `app.json` now declares `automatic` and the scheme is set from the palette's own lightness,
  once at startup so the login screen is right before any server has been asked, and again
  when branding arrives.
  Deliberately not the browser harness this session: the dev server left running for a device
  test serves the working tree live, and patching `session.ts` for the harness would have
  served that patch to any connected phone — the hazard documented last session. Verified
  green: typecheck 4/4, `pnpm -r test` **341**, `pnpm -r build`, `expo prebuild` (which is
  what validates the `app.json` change). Dev server still up on `192.168.1.211:8081` and
  `100.81.57.116:8081`.
- **2026-08-23 — Mobile app: accessibility audit; both bottom sheets were unreachable.**
  Audited every interactive control rather than spot-checking. Names were fine — all 26 have
  a discernible one, either explicit or from visible text. Roles were not: only 11 announced
  themselves as buttons, so Sign in, Sign out, Download, retry-after-failure, the folder chips
  and the upload-target rows were all read out as plain text with no indication they could be
  tapped. Now 18, which is all of them; the remaining 8 are correct to leave, being four
  inside `<Link asChild>` (expo-router gives them link semantics, and a link is what they are)
  and four modal backdrops and tap-swallowing wrappers.
  Those last four turned out to hide a real defect. React Native's `Pressable` sets
  `accessible` to true unless told otherwise, and an accessibility element hides its own
  children — so the backdrop and inner wrapper of each bottom sheet meant **the sheets for
  choosing an upload library and choosing a subtitle track were each announced as a single
  shape with nothing reachable inside**. Both are now marked `accessible={false}`, which
  leaves the rows individually reachable and still lets a tap on the backdrop dismiss. This is
  code written this week; it would not have been found by looking at the screen.
  Also checked and left alone: `Image` is not an accessibility element in React Native unless
  asked to be, so posters are not announced redundantly; and the caption overlay is left
  readable, since a cue changes only when the cue changes. Verified green: typecheck 4/4,
  `pnpm -r test` **341**, `pnpm -r build`, `expo prebuild`.
- **2026-08-23 — Mobile app: one like no longer refetches the whole library.** Audited
  subscription cleanup first and found it correct everywhere — `useDownloadState`,
  `useDownloads` and `useStoredSession` all unsubscribe, and the last guards its async setState
  with an `alive` flag. The real find was next door. Toggling a like ended with
  `invalidateQueries({ queryKey: ['media'], exact: false })`, and the library is an *infinite*
  query: invalidating one refetches **every page already loaded**. Someone who had scrolled to
  95 items paid three list requests per like, to be told what the mutation response had
  already returned. Liking a handful of things in a row over a slow tailnet meant a dozen
  refetches of the whole library. Invisible in a desktop harness, unpleasant on a phone.
  The response carries the authoritative `liked` and `likeCount`, so it is now written
  straight into every cached page — all filters, not just the visible one, since the grid, the
  liked-only view and a folder view are separate cache entries and a like has to be true in
  all of them. Five tests, both control-tested: patching only the first page fails three (an
  implementation that would look right in any hand test, because nobody scrolls in a hand
  test), and dropping the guard that skips the detail query fails the one that matters most —
  `['media']` also matches `['media', id]`, which is not paged, and treating it as paged would
  replace the detail with a malformed object and render an empty screen.
  One behaviour changed on purpose and is documented: unliking while the liked-only filter is
  on now leaves the item on screen with an empty heart instead of snatching it away mid-tap,
  which makes a mistap undoable. The query is marked stale without refetching, so the list
  corrects itself next time it is opened. Verified green: typecheck 4/4, `pnpm -r test`
  **346**, `pnpm -r build`.
- **2026-08-23 — Mobile app: the grid stops re-rendering while you type.** `MediaTile` was a
  plain component and `renderItem` an inline arrow, so every keystroke in the search box —
  which sets state on each character — re-rendered every visible tile, each one a link, a
  pressable and an image with its own state and effect. Costs nothing on a desktop and is the
  usual shape of typing lag on a phone. Now memoised.
  Worth recording how the accompanying test went, because it went badly twice. The first
  version asserted that untouched cards keep their object identity through a cache write, on
  the grounds that memo depends on it. Control-tested by rebuilding every card: **it passed**,
  because TanStack does structural sharing and collapses a deeply-equal object back to the
  original reference — so the test was describing the library, not this code. Retargeting it
  at the client the app actually builds and disabling `structuralSharing` there **also
  passed**. Two controls, neither able to fail it, so it was deleted rather than kept with a
  confident comment behind it. The comment on `MediaTile` now claims only what was
  demonstrated: typing does not touch the cache, so the cards come back identical and the
  comparison holds.
  A process note from the same episode: a broken test file was reported as "148 passed"
  because only the `Tests` line was being read, and a file that fails to *collect* does not
  appear there. Both `Test Files` and `Tests` are checked now.
  The five other tests around the like path stand — control-tested earlier, catching
  first-page-only patching and corruption of the detail query. Verified green: typecheck 4/4,
  `pnpm -r test` **346**, `pnpm -r build`.
- **2026-08-23 — Mobile app: a download could be listed twice, and one screen had no
  pull-to-refresh.** Read the two screens never previously examined.
  The Downloads tab keys its rows by id over `[...failed, ...active, ...items]`, and
  `startDownload` published the finished record to the index but only retired the in-flight
  entry in its `finally` — so for the length of a storage write the item was in both lists.
  Any *other* transfer's progress tick emits during that window, and the tab would render the
  same id twice. Concurrent downloads are ordinary, so this was reachable. The in-flight entry
  is now retired in the same breath as the record is published; the `finally` still clears it
  for the failure paths.
  The test needed two attempts and the control caught the first. Holding the next storage
  write to observe the window did nothing, because `startDownload` hydrates first and
  hydration ends with a write of its own, which swallowed the hold — the test passed against
  deliberately broken code. Hydrating first in the test fixes it, and the control now fails
  with the id present in both lists.
  Also: `app/collection/[id].tsx` was the only list screen without pull-to-refresh. Browse,
  Clips and Collections all have it; Downloads correctly does not, being local state with
  nothing to refetch. Added, matching how Browse guards the spinner against
  `isFetchingNextPage`. It cannot be checked in the browser — `RefreshControl` is inert under
  react-native-web — so it needs a device.
  Reviewed and left alone: the collections list screen, and `useCollection`, which fetches
  rather than assuming the list is already cached. Verified green: typecheck 4/4,
  `pnpm -r test` **347**, `pnpm -r build`.
- **2026-08-23 — Mobile app: a blank-screen crash shipped last session, found by accident.**
  The intended work was wiring `focusManager` to `AppState`. TanStack's `refetchOnWindowFocus`
  is on by default but inert on React Native, since nothing reports a focus change without
  that wiring — so returning to the app showed whatever it last held, and media added, liked
  or scanned from the web app stayed invisible until something was pulled to refresh. Wired,
  and verified in the harness: one request, still one after 32 seconds idle while hidden, two
  the moment the app is made visible. No spurious refetch while backgrounded, exactly one on
  return.
  Setting that up surfaced something worse. **The app did not render at all** — empty body,
  zero requests — because of last session's change: `Appearance.setColorScheme` is typed by
  React Native as always present, but react-native-web does not implement it and the platform
  docs put it at iOS 13+ / Android 10+. Called unguarded during the root's first render, it
  threw and took the whole app down to a blank screen, with no error state, because the
  component that would draw one never mounted. Now guarded.
  Worth recording why it was missed: last session deliberately skipped harness verification —
  the dev server was up and patching `session.ts` for the harness would have served that patch
  to a phone — and settled for typecheck, the Metro bundle and `expo prebuild`. All three pass
  straight through a runtime throw in a `useEffect`. The right move was to stop the dev server
  and verify, which is what was done this time. A troubleshooting note now records the
  signature, since a blank screen is indistinguishable from a hung network by eye.
  Verified green: typecheck 4/4, `pnpm -r test` **347**, `pnpm -r build`. Dev server stopped
  for the harness and restored afterwards, reachable again on `192.168.1.211:8081` and
  `100.81.57.116:8081`.
- **2026-08-23 — Mobile app: browser checks no longer require editing source.** Last session
  shipped a crash because verifying a change and leaving a scannable dev server were mutually
  exclusive: the browser build needed `src/lib/session.ts` patched to give web somewhere to
  keep a session, Metro serves the working tree live, so the patch would reach any connected
  phone. Faced with that choice the check was skipped, and an unguarded platform call took the
  app down to a blank screen.
  Fixed at the cause rather than by being more careful. The storage call is now behind a seam,
  `src/lib/secure-store.ts`, with a web variant beside it that Metro picks automatically when
  bundling for web. No patching, so the two can run at once — demonstrated by exporting for
  web with `expo start` up and signing in through the browser afterwards, session and all.
  Verified the seam did not leak the wrong way: the Android Hermes bundle contains the
  SecureStore path and neither `localStorage` nor the web file's comment. That check was
  vacuous on the first attempt — the glob matched an empty directory, so "clean" meant nothing
  — and now carries a positive control that greps for a known app string first.
  `react-native-web` and `react-dom` move to devDependencies, since web is now an
  acknowledged development target rather than something assembled by hand each time.
  Documented under Testing, including what the browser cannot reach. Verified green: typecheck
  4/4, `pnpm -r test` **347**, `pnpm -r build`. Dev server stayed up throughout.
- **2026-08-23 — Mobile app: regression sweep over everything that had shipped unverified.**
  With browser checks now safe to run beside the dev server, the first use was the backlog:
  several changes had been merged on typecheck and a green bundle alone, which is exactly how
  the blank-screen crash got out. Walked the whole app in one pass and checked the console on
  the way, since that crash was invisible except there.
  All of it holds. Accessibility roles reach the DOM as roles, not just as props — five
  buttons and three links on the library screen. The duration badge is white on a fixed dark
  pill, so the light-preset contrast fix is real. Liking flips the control and triggers
  **zero** list refetches, which is the cache patch behaving as designed and the first
  end-to-end confirmation of it. Folder drill-down still works through the chip that gained a
  button role. All five tabs render, including the two never previously seen: Downloads shows
  its empty state and Settings reports the account, server and storage. A clean reload leaves
  no `setColorScheme` exception, so last session's crash is gone.
  One recurring console error chased to its cause rather than assumed harmless:
  `NetworkError ... at componentDidMount`, seven of them, matching exactly seven poster
  requests answered 401. react-native-web's `Image` drops the headers on a source, so
  thumbnails go out unauthenticated. It is a property of the browser build, not of the app —
  on a phone `Image` does send them, which is why this app carries a bearer token at all — and
  it is now written down so nobody spends an afternoon on it.
  No new defects. Verified green: typecheck 4/4, `pnpm -r test` **347**, `pnpm -r build`. The
  dev server stayed up for the whole sweep, which was the point of last session's work.
- **2026-08-23 — Mobile app: the app no longer asks for the microphone or the camera.**
  Looked at what a real build produces, which Expo Go hides — it runs under its own manifest,
  so nothing in `app.json` is exercised until someone builds properly.
  `expo-image-picker` adds `RECORD_AUDIO` by default and permits `CAMERA`, because it can also
  take a photo. This app only ever opens the library, so both were being requested for
  nothing. On Android that is a permission prompt users notice; on iOS an unused usage string
  is something App Review asks about. Both are now off in `app.json`, and the regenerated
  manifest carries `tools:node="remove"` for each with no plain declaration left, so a built
  APK will not request them. The iOS half — dropping `NSCameraUsageDescription` and
  `NSMicrophoneUsageDescription` — follows from the same plugin options but is unverified
  here, since `expo prebuild` on this machine only generates `android/`.
  Two things checked and found already correct, rather than assumed. The upload permission
  gate does not lock anyone out: on Android 13+ `getMediaLibraryPermissions` returns an empty
  array, because `launchImageLibraryAsync` goes through the system Photo Picker and needs no
  permission at all, and below 13 it asks for the storage permissions the manifest does
  declare. And the config that matters is present — `usesCleartextTraffic` for a plain-HTTP
  server, the `freewan` deep-link scheme, unlocked orientation for video.
  Left alone: `SYSTEM_ALERT_WINDOW` and `VIBRATE`, which come from React Native's own template
  and are used by the dev overlay.
  **No APK could be produced here: there is no Android SDK on this machine and the installed
  JDK is 26, newer than the React Native Gradle plugin supports.** That is now written down
  alongside the build instructions. Verified green: typecheck 4/4, `pnpm -r test` **347**,
  `pnpm -r build`, expo-doctor 18/18.
- **2026-08-23 — Mobile app: the last unused permission string removed, and an unverified
  claim made verified.** Last session recorded the iOS half of the camera/microphone change as
  unverified, because `expo prebuild` had only produced `android/`. Running it with
  `--platform ios` established why rather than leaving it a guess: Expo refuses to generate
  iOS project files anywhere but macOS or Linux. `expo config --type introspect` gets there
  another way — it applies every config plugin and prints the resulting `ios.infoPlist` — and
  confirms the camera and microphone strings are gone and the photo-library one carries the
  text written for this app.
  That introspection turned up one more: `NSFaceIDUsageDescription`, added by
  `expo-secure-store` because storage *can* be put behind biometrics, carrying the library's
  stock "Allow FreeWAN to access your Face ID biometric data". This app stores its token
  plainly — `requireAuthentication` appears nowhere — so the string was both unused and not
  written for it. Off now; the Info.plist is down to exactly three things, all of which the
  app does: the photo library, background audio, and local networking.
  Checked afterwards that the Android side was not disturbed, and did it properly the second
  time: reading the introspected JSON returned nothing at all, which said nothing, so the real
  regenerated manifest was read instead. Backup rules, cleartext traffic and the two permission
  removals are all intact.
  One security property verified for the first time along the way. The manifest points at
  `@xml/secure_store_backup_rules`, which is not in the app module — it comes from the library
  and is merged at build time, so the reference resolves rather than breaking the build. Its
  contents exclude the secure store from cloud backup and from device-to-device transfer, so a
  session token does not follow a restore onto a new phone. Recorded in `docs/13-security.md`.
  Verified green: typecheck 4/4, `pnpm -r test` **347**, `pnpm -r build`, expo-doctor 18/18.
- **2026-08-23 — Whole pipeline run locally; the README was out of date.** No behaviour
  changed. Sessions have been ending by asking for 50-odd commits to be pushed without anyone
  establishing that CI would survive them, so the whole workflow was run as CI runs it:
  `pnpm install --frozen-lockfile` (in sync — worth checking, since dependencies moved twice
  this week), `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r test` (**347**), and
  `pnpm test:e2e`, which had not been run once this session. **All 18 Playwright flows pass**,
  including the axe WCAG audits of every major web page. Pushing is safe.
  Housekeeping found nothing wrong. The production bundle is 3.0 MB of Hermes bytecode per
  platform, 3.5 MB exported, with the 384 KB Ionicons font the largest asset — subsetting it
  for the dozen or so glyphs used would save around a tenth of the app for a build-step
  complication, and has not been done. Five declared dependencies are never imported —
  `@babel/runtime`, `expo-constants`, `expo-linking`, `expo-system-ui`, `react-native-screens`
  — all of them peer requirements of expo-router and React Navigation that Expo's own docs say
  to declare, and none of which affect bundle size, since what ships is what is imported.
  `packages/web/dist` holds the real web app rather than a leftover mobile export.
  The README was wrong in two ways and is fixed: it claimed **186 tests (173 backend + 11 web
  + 2 shared)**, which predates both the mobile package and 7 API tests, and its one-line
  description of the app still described only offline playback — uploads, subtitles and
  branding have all landed since.
- **2026-08-23 — Mobile app: deep links opened the library instead of the item.** Chased a
  bounce noticed in passing several sessions ago and never followed up. A link straight to
  `/media/<id>` — which is what the `freewan://` intent filter in the Android manifest exists
  to receive — landed on the library. The API log settled what was happening: the item's
  detail *was* fetched, so the screen mounted, and then the library's queries followed. The
  app arrived and left again.
  The cause was the branding work. Applying branding mutates a token singleton, which does not
  re-render anything, so the root was keyed on a version number to force it — and a key change
  remounts, and a remount resets the router, discarding the route it had just resolved.
  Confirmed by disabling the version bump and watching the deep link land.
  Fixed by not remounting at all: the app is held back until branding has settled, so the tree
  mounts once already wearing the right colours. Verified both halves together — the deep link
  lands, and a light `linen` preset still applies through it, background, text and primary.
  The wait is capped at two seconds, since `fetch` has no timeout here and a server that
  accepts a connection then says nothing would hold the app on a blank screen for as long as
  the platform allows. Proving the cap took three attempts: absolute timings in a backgrounded
  browser tab are worthless, because throttling put first render at 8.7s even against a
  *healthy* server. The measurement that works compares rather than times — a server that
  stalls `/api/branding` for thirty seconds, and the app renders with that request still
  outstanding.
  Verified green: typecheck 4/4, `pnpm -r test` **347**, `pnpm -r build`.

- **2026-08-23 — Mobile app: a freshly installed app never picked up the server's branding.**
  Reading `useBranding` for something else showed it returning early when no server address is
  stored, with `[]` deps and nothing to bring it back. On a first launch that is always the
  case — the address is typed on the login screen, so at startup there is no server to ask.
  Signing in stored one and nothing noticed.
  Confirmed against a server branded "Dawson Media" with the light `linen` preset: a first-run
  sign-in gave `{"screenBg":"rgb(11, 11, 16)","brandingFetched":0}` — the built-in dark palette,
  and `/api/branding` never requested. The app would have looked right only after being killed
  and reopened, which is not what a phone that has just scanned the QR code does.
  Fixed by fetching on session changes as well as at startup, keyed on the server address so a
  different server refetches and the same one does not. The re-render is a state bump rather
  than a key, deliberately: keying the root remounts it, which is what broke deep links a
  moment ago. Same run, after the fix: `{"screenBg":"rgb(243, 239, 230)","brandingFetched":1}`,
  branding applied without a restart, and the deep link to `/media/<id>` still lands on the item.
  This is the third defect from the sequencing in this one file, so the logic is now split out
  of the hook as `startBranding` — a plain function over two callbacks — and covered by **eight
  tests**. Every one was control-tested against a deliberately broken copy: removing the
  subscription fails five of them including the first-run test, and removing the dedupe, the
  retry-after-failure reset, the colour-scheme resync, and the cap each fail exactly their own.
  The teardown test needed a second pass. It asserted that branding arriving after teardown is
  not applied, which the `cancelled` flag already guarantees, so it passed against a version
  that never unsubscribed — a leak of one listener per remount. It now checks the listener set
  directly, and the control fails.
  Verified green: typecheck 4/4, `pnpm -r test` **355**, `pnpm -r build` (both Hermes bundles,
  iOS 3.13 MB and Android 3.12 MB).

- **2026-08-23 — Mobile app: returning to the app dragged the video backwards, and a
  downloaded one never resumed at all.** Two defects in the same few lines of the media screen.
  The first: the seek that resumes playback was an effect keyed on `resumeAt`. That value is
  nothing more than the position this app itself last posted — `playback.ts:49` returns the
  stored `positionS` — and `/api/media/:id/playback` is refetched every time the app returns to
  the foreground, since `refetchOnWindowFocus` is on and `focusManager` is wired to `AppState`.
  So each switch away and back re-ran the effect with a position up to one reporting interval
  behind the live playhead, and yanked the viewer there. Longer if the video kept playing in
  the background while the reporting timer was suspended. The web player does not have this: it
  seeks from `loadedmetadata`, once. The comment above the effect even claimed a ref stopped a
  re-buffer dragging the viewer back, but the ref guarded only the other of the two seek paths.
  The second: `usePlayback` was disabled whenever a local copy existed, on the grounds that
  there was no URL to ask for. But that response also carries the resume position and the
  subtitle tracks, so a downloaded video started at the top and had no subtitles — while the
  app went on reporting its position, so the web app would resume the very same video. The
  query is now asked for every video; the route is three DB reads with no transcode, and
  nothing on the screen waits for it, so an item downloaded for offline use still plays with
  the server unreachable.
  Fixing both together needed the ordering to change: a local file can be ready to play before
  the server answers, where a streamed one cannot be, since the URL being played comes from
  that same answer. The decision now waits for both and is made exactly once. It lives in
  `resumeSeek` with **6 tests**, each control-tested — dropping the wait for the player, the
  wait for the server, the once-only rule, or the deliberate "start at the top" answer each
  fails its own test and only its own.
  Verified in the browser only as far as the browser goes: the screen renders unchanged and
  `/playback` is requested. The seek itself cannot be reached there — `/api/media/:id/stream`
  is never requested at all, because expo-video's web build does not start loading, so
  `readyToPlay` never fires. Both fixes are on the device list.
  Verified green: typecheck 4/4, `pnpm -r test` **361**, `pnpm -r build`.

- **2026-08-23 — Mobile app: stopping a download at the wrong moment left an item that could
  not be played.** Found by reading the download manager rather than by hitting it. The Stop
  control stays on screen until the in-flight entry is retired, and that does not happen until
  the poster has been fetched — a second request, over the same connection that is quite
  possibly the reason the user is reaching for Stop. A cancel landing in that gap deletes both
  files, and the transfer then carries on and writes its record anyway. The Downloads tab
  listed an item of 0 KB whose file was gone; opening it gave the player a dead `file://` URI,
  and nothing noticed until the next cold start pruned it.
  Written as a failing test first, which is the order this should always have been in: it
  reported `expected 'done' not to be 'done'`, with the file already deleted.
  Fixed by checking for a cancel before publishing the record, and cleaning up if one arrived.
  A second, much narrower gap sits between clearing the in-flight entry and the storage write
  that follows it — the task is still cancellable there, but the transfer is over and every
  byte is on disk, so a cancel is now a no-op rather than a deletion. Two guards, **3 new
  tests**, each control-tested: removing the first fails both of its tests, removing the second
  fails only its own. The filesystem stub gained a hold on the poster fetch, since that gap is
  the only place a cancel can land on a transfer that has otherwise finished.
  Not checked in the browser, and it would not have been worth it: neither guard touches
  rendering, and `expo-file-system` does nothing on web, which is why the download manager is
  exercised against a virtual filesystem in the first place.
  Verified green: typecheck 4/4, `pnpm -r test` **364**, `pnpm -r build`.

- **2026-08-23 — Mobile app: every filter tap took the filters off the screen.** The library
  screen returned a full-screen spinner while its query loaded, and every filter, folder and
  search term is a query key of its own — so each one starts with nothing cached and reports as
  loading. Tapping "liked only" therefore removed the control that had just been tapped, along
  with the search box, the other two toggles and the folder chips, until the server answered.
  Proved before touching anything, with a proxy in front of the API that holds `/api/media`
  back by 1.5s: sampling the DOM after the tap caught `search: false, toggles: 0` mid-fetch.
  After the fix the same measurement reads `S3` at every sample through the whole 2s — the
  controls never leave. Submitting a search keeps the box and its text as the results narrow,
  and a query with no matches still lands on "No results" rather than a spinner that stays.
  The spinner now sits in the list, where the results it is waiting for will go.
  Two smaller things in the same pass. The upload button answered a tap with "No library on
  your server accepts uploads" whenever the request for those libraries had *failed* — a claim
  about the server on the strength of an answer that never arrived, which is the same lie an
  empty state tells when it stands in for an unreachable server, and the reason `ErrorState`
  exists. It now separates the two; `uploadBlocker` holds the decision, with **3 tests** and a
  control that fails the one that matters. And the offline hint on the library read "1 download
  are still playable".
  A note on the harness rather than the app: the first run after rebuilding produced a blank
  page and no API calls at all. The cause was `harness-up.sh` deleting and recreating
  `packages/web/dist` under a running server, which then served `index.html` for the bundle —
  1174 bytes where the file on disk was 1.37 MB. Restart the API after a rebuild.
  Verified green: typecheck 4/4, `pnpm -r test` **367**, `pnpm -r build`.

- **2026-08-23 — Mobile app: a video that would not play was a black rectangle and nothing
  else.** `expo-video` reports the failure through `statusChange` and draws nothing, and both
  player screens ignored it — so a rejected token, an HLS ladder that was never built, and a
  server that went away mid-buffer all looked the same as a video taking its time. This app
  already refuses to let an empty state stand in for an unreachable server; a silent player
  was the same lie told by a different screen.
  Both screens now show the player's own message over the frame, with a retry that reloads the
  source. The message is not replaced with something friendlier: it is the only clue there is.
  The overlay's colours are fixed rather than themed, like the duration pill and for the same
  reason — it sits on the black of the video frame, where `theme.color.text` is near-black
  under any light preset.
  The first version of the retry restarted an hour-long video from the top. It now takes the
  position the playhead had reached and feeds it through `resumeSeek`, whose once-only rule
  applies per attempt: reloading the source is a new attempt, so the screen clears the flag.
  A clip retries from its in-point instead, which is what a clip is.
  Written against the real types rather than from memory: `StatusChangeEventPayload` carries
  `{status, oldStatus?, error?: {message}}` and `replaceAsync` is what reloads a source.
  Verified only that neither screen regressed — both render, with the buttons and metadata
  they should have and no overlay where there is no error. The overlay itself cannot be
  reached in the browser: the web build's video element never issues a request, so it never
  reports ready and never reports an error either. Pointing it at a URL that does not exist
  produced no error event at all. It goes on the device list, where it should earn its keep.
  Two tests were written for the retry path and then deleted rather than kept: they asserted
  what the existing `resumeSeek` tests already assert, with different numbers.
  Verified green: typecheck 4/4, `pnpm -r test` **367**, `pnpm -r build`.

- **2026-08-23 — Mobile app: none of the three text inputs had a name a screen reader could
  read.** Every button in this app carries a label, and the ones that needed thinking about got
  it — but the text fields had been missed entirely. The change-password screen was the worst
  of them: three secure fields, no `accessibilityLabel`, no placeholder to fall back on, and
  the visible labels above them are sibling `Text` nodes, which name nothing. Measured rather
  than assumed — all three inputs came back with `aria-label`, `aria-labelledby`, placeholder,
  `title` and any associated label element all null. Someone using VoiceOver or TalkBack would
  have had to guess which box was which to change their own password. The login screen's
  password field was in the same state; its other two at least had placeholders, which are the
  value's understudy and not a label.
  All three screens now label their fields, and the validation text goes through as a hint.
  After the fix the same probe reads "Current password", "New password", "Confirm new password"
  on one screen and "Server", "Username", "Password" on the other. A sweep of every interactive
  element across all eight screens — buttons, links, inputs — now finds nothing unnamed.
  Reaching the change-password screen at all meant creating a user through the admin API and
  resetting its password, which is what sets the flag. Worth the setup: that screen and its
  gate had never been exercised in a browser. Both work. Signing in as that user lands on it,
  a short password says "At least 8 characters", a mismatch says "These do not match", and
  saving releases the gate to the library.
  No test was added. Labels on JSX are not unit-testable without a renderer this package does
  not have, and the browser probe above is the verification; a test asserting the string is
  passed to the prop would only restate the diff.
  Verified green: typecheck 4/4, `pnpm -r test` **367**, `pnpm -r build`.

- **2026-08-23 — Mobile app: opening a photo downloaded the whole original, every time.** The
  detail screen asked `/api/media/:id/raw` with no width, which is the full file off someone's
  camera — pulled over a tailnet and decoded into a phone's memory to be drawn at a fraction of
  its size. The web app has always asked for a size fitted to its viewport. The phone, which is
  the device that actually pays for the difference in data and in memory, was asking for the
  largest thing on offer.
  Measured against a 4032x3024 photo added to the harness library for the purpose: **638 KB
  whole, 54 KB at `w=1280`** — the width a mid-sized phone would ask for. Roughly twelve to
  one, and the server keeps each variant on disk, so the second request for one took 4.8ms.
  `displayWidthFor` decides the width, with **6 tests**, each control-tested. It rounds up to a
  multiple of 320 rather than asking for the exact pixel width, because every distinct width is
  a JPEG the server renders and stores, and the few points between one handset and the next are
  not worth a file each. It stops at 2560. And it asks for nothing at all when the photo is
  already no larger than the request would be: the resizer runs `scale=w:-2`, which enlarges as
  readily as it shrinks, so asking for more than the source holds returns a *bigger*, softer
  file than the original.
  Verified end to end in the browser by watching what the app actually requests: the 4032-wide
  photo asks for `raw?w=2560` in a 3440px window — the ceiling doing its job — the 1600-wide
  one asks for `raw` with no width at all, and the video screen asks for `/raw` never.
  One thing that surfaced while measuring, pre-existing and web-only: React Native's `Image`
  does not send the header the source carries when it runs on react-native-web, so every
  authenticated image 401s in the harness. It is why photos and posters have never drawn there.
  Downloads still take the original: an offline copy should be the photo, not a view of it.
  Verified green: typecheck 4/4, `pnpm -r test` **373**, `pnpm -r build`.

- **2026-08-23 — Mobile app: a session revoked elsewhere, a 95-item library, and a checklist
  for the phone.** No defects this pass, which is worth recording as plainly as a fix would be.
  Three things were checked that had only ever been reasoned about.
  A revoked session, end to end. The app's own token was revoked from outside while it held it,
  then the app was made to talk to the server: the 401 cleared the token from storage, the
  session change moved the gate, and the app landed on the login screen with the server address
  still filled in — signing back in took a username and a password and nothing else. That is
  the path every expired or admin-revoked session takes and none of it had been watched.
  Pagination over a real library. A 95-item repository, walked page by page through the cursor:
  40, 40, 15, no duplicates across pages, nothing missing, and the cursor stops. Worth checking
  because a cursor over a key that ties — 95 files scanned in one pass share a timestamp
  closely — can repeat or skip items, and the infinite list would show it as either.
  An audit of every `useEffect` in the package against the failure that has produced three
  separate defects here: an effect keyed on a value that changes under it. Sixteen effects,
  all sound. The one dead eager-seek in the clip screen is noted rather than removed, since it
  is harmless and pre-existing.
  What came out of it is a section in the mobile doc: **Checking it on a phone**, thirteen
  ordered steps saying what to do and what should happen, replacing a paragraph that had been
  accreting "and this needs a device too" clauses for several sessions. Playback, the resume,
  the backwards-jump fix, both edges of the download cancel, the offline copy, clips,
  subtitles, uploading, the keychain, and the screen reader on the password fields. It is the
  work standing between this app and being finished, and it is ten minutes with a phone.
  Verified green: typecheck 4/4, `pnpm -r test` **373**, `pnpm -r build`.

- **2026-08-23 — Mobile app: a download the app never came back from left its bytes on the
  phone forever.** A record is only written once a transfer finishes, so a download interrupted
  by the app going away — force-quit, a reboot, the system reclaiming memory partway through a
  multi-gigabyte video — left everything it had written with nothing pointing at it. Hydration
  already drops records whose files have gone; nothing looked the other way, at files no record
  claims. And because the Downloads tab and the storage figure in Settings are both built from
  the index, the space was not merely wasted, it was invisible: a phone quietly short several
  gigabytes with an app reporting a few hundred megabytes.
  Startup now sweeps the download directory for names no record accounts for. It matches on
  name rather than on `localUri` — the names are ours, built from ids, while a URI has been out
  to the platform and back, and deleting someone's downloads over a difference in encoding is
  not a risk worth running. Safe at that point because hydration happens once and every
  transfer waits on it, so nothing in flight can be caught by it.
  **2 tests**, and the second is the one that matters: a poster's name is an id with a suffix,
  not an id, so a careless sweep would eat every thumbnail it had just kept the file for. Both
  control-tested — removing the sweep fails the first, dropping posters from the known set
  fails the second and only the second.
  Not checked in a browser, for the same reason as the other download work: `expo-file-system`
  does nothing on web, which is why this manager is exercised against a virtual filesystem.
  Verified green: typecheck 4/4, `pnpm -r test` **375**, `pnpm -r build` — the mobile build
  logged a Metro cache warning, fell back to a full crawl, and produced both Hermes bundles.

- **2026-08-23 — Mobile app: the check that reads both sides of the API contract had a blind
  spot, and my own last change had walked into it.** That test pulls every `/api/...` path out
  of this package's source and fails if the server registers no route for it. It exists because
  an early version called an endpoint that was never written and nothing noticed until a screen
  404'd on a device.
  It extracted paths with an expression that stopped at the first backtick or space. The photo
  path added an hour earlier is
  `` `/api/media/${id}/raw${photoWidth ? `?w=${photoWidth}` : ''}` `` — a hole containing both.
  It matched nothing at all, and the path was passed over in silence. The test's own comment
  says an unreadable path "is a reason to fail rather than to skip"; that was not true of a
  path shaped like this one.
  Coverage did not actually lapse, and only by luck: `downloads.ts` asks for
  `/api/media/${id}/raw` as a plain literal, so the route stayed covered by a different call
  site. The count of checked paths is identical before and after — 21 either way.
  Replaced with a scan that walks each `${...}` hole to its closing brace, counting depth so a
  nested template cannot end it early. Control-tested with a call to an endpoint that does not
  exist, written in exactly that shape: the old expression **passes silently**, the scan fails
  and names the path. The first probe written for that control was not faithful — it used
  `${'x'}`, whose quote the old expression treats as a closing delimiter, so it failed for the
  wrong reason and would have been reported as a passing control that proved nothing.
  Verified green: typecheck 4/4, `pnpm -r test` **375**, `pnpm -r build`.

- **2026-08-23 — Mobile app: a mutation pass over the logic whose failures are invisible, and
  one real defect from it.** Last session found a check that did not check what it claimed, so
  the same question was put to the rest: for each piece of logic, break it deliberately and see
  whether anything fails. Twenty-odd mutations across the auth gate, the query defaults, the
  request layer, caption timing, clip boundaries, list paging, the session emitter and the
  cache patch. All caught, which is the answer worth having about a gate that decides where an
  unauthenticated user is sent.
  Two survived, and they are different from each other.
  The first is an equivalent mutant, not a gap. Deleting the `204` short-circuit in the request
  layer changes nothing: `res.text()` on a 204 returns an empty string and the parse already
  answers `undefined`. Checked that the path it stands for *is* covered — making a successful
  empty body go through `JSON.parse` unconditionally does fail a test, which is the failure
  that would break changing a password.
  The second was real. Replacing the WCAG luminance weighting in `isLight` with a plain average
  of the channels left all 27 palette tests passing — and the two are not close: pure green is
  0.715 weighted and 0.333 averaged. `isLight` decides the status bar's content colour and the
  platform colour scheme from the background, so it runs on whatever colour an admin picked.
  Looking at it properly turned up a second thing wrong with it: the threshold was **0.5**, the
  midpoint of the scale, where what matters is the midpoint of legibility. Black and white text
  are equally readable at a luminance of 0.1791 — `sqrt(1.05 x 0.05) - 0.05`. A mid-grey sits
  at 0.216, where black text reaches 5.3:1 and white 3.9:1, and the old threshold gave it white.
  Both fixed, with **3 tests**: green light and blue dark together, which no unweighted formula
  can satisfy; the crossover from both sides; and every shipped preset landing on the mode it
  declares. Control-tested — the average now fails two of them, and moving the threshold to
  either 0.5 or 0.02 fails others. Every preset that ships is far from the crossover and none
  of them change.
  Verified green: typecheck 4/4, `pnpm -r test` **378**, `pnpm -r build`, both Hermes bundles.
  The mobile build logged a Metro cache warning again and fell back to a full crawl; the cache
  in `node_modules/.cache` is stale from the SDK upgrade and rebuilds itself each time.

- **2026-08-23 — The `linen` preset's muted text now meets WCAG AA, in both apps.** This had
  been sitting on the open list for several sessions as something to be decided rather than
  done, on the grounds that the mix is shared with the web app and changing it is a design
  decision. That was over-cautious. Raising contrast on text that fails AA is not a trade-off
  against anything; it is the fix, and it belongs in both places at once.
  Measured across all seven presets: muted against its own background ran 6.1 to 7.1 on the
  five dark ones, 4.58 on `paper`, and **4.41 on `linen`** — under the 4.5 that normal text
  needs. The share of text mixed into the background moved from 62% to **65%**, in
  `packages/web/src/index.css` and `packages/mobile/src/lib/palette.ts` together, which is the
  whole point of that file: a preset has to resolve to the same values in both apps rather than
  to similar ones. 63% would have cleared it at 4.54 and is too close to the line to be worth
  having; 65% puts the tightest preset at 4.83 and moves the colour by about seven parts in
  255, which is not a visible change to anything that was already passing.
  Worth saying plainly: 62% was itself chosen to hold AA on both background and surface — the
  comment in the CSS says so — and did not manage it. This corrects that arithmetic rather than
  making a new decision about the design.
  The mobile test suite had recorded the shortfall honestly, exempting `linen` from the AA
  check with a test that asserted the failure and a note saying that retuning the preset should
  fail it and prompt the exemption's removal. It did, and it has. Every preset now goes through
  the same check with no exceptions.
  One test caught the change and had to be re-derived rather than adjusted: the muted literal
  for the default preset is pinned to what a browser's `color-mix` produces, so the new value
  was worked out away from the code — 233 x 0.65 + 11 x 0.35 = 155.30, 238 x 0.65 + 16 x 0.35
  = 160.30, giving `#9b9ba0`. Control-tested: a one-point change in the mix still fails it.
  Verified green: typecheck 4/4, `pnpm -r test` **378**, `pnpm -r build`, and `pnpm test:e2e`
  **18/18**, six of which are axe WCAG A/AA audits of the web app. Those audits run on the
  default preset, which is why they never saw this one.

- **2026-08-23 — Mobile app: a dark tab bar under a cream app, after a first sign-in.** Found
  by going back to look at the screens after changing colours that affect all of them, which is
  the only reason it was found at all: it is a defect you see rather than one you reason your
  way to. Measuring the rendered colours on a `linen` server showed the tab bar's label at
  `rgb(155,155,160)` and its background at `rgb(22,22,29)` — the *built-in dark* palette —
  under a screen at `rgb(243,239,230)`. Restarting the app fixed it, which placed the fault
  exactly: on the sign-in transition, not at startup.
  The cause is the last unswept corner of the mutable-token design. Tokens are mutated in place
  and everything that draws with them picks them up on its next render — but React Navigation
  keeps a navigator's `screenOptions` from when that navigator mounted, and a state change in
  the root layout never reaches it. The tab bar therefore wore whatever palette was in force
  when the tabs first appeared, which on a first run is the built-in one. This is the fourth
  defect out of this design and the second of them to be a first-run problem; the ADR warned
  that half-applied branding "would look broken", and this is what that looks like.
  A token change is now announced through a small store — `useBrandingVersion`, on
  `useSyncExternalStore` — rather than through a callback that only the root layout heard. The
  tabs layout subscribes. `startBranding` loses its second callback, and the test that used to
  count calls to it now counts notifications from the store, which is the same property
  observed where it now lives. Both control-tested: never announcing the change fails one test,
  bumping the counter without telling anyone fails another.
  Verified in the browser on the sequence that produced it — a first-run sign-in against a
  `linen` server now gives a tab bar at `rgb(251,248,242)` with its label at `rgb(108,104,96)`,
  and the deep link to an item still lands on the item rather than the library.
  Verified green: typecheck 4/4, `pnpm -r test` **378**, `pnpm -r build`.

- **2026-08-23 — Mobile app: several controls announced an icon before their name.** Two
  findings from one sweep, and the second came out of a mistake made during the first.
  The sweep itself was the useful idea: after a first-run sign-in against a `linen` server,
  walk every screen and flag any element still painted in the palette this app ships with. That
  is the check that would have caught last session's dark tab bar, written down and run over
  nine surfaces — the five tabs, a video, a photo, a clip, the subtitle sheet, and the login
  screen after signing out. All clean. The tab bar was the only stale surface there had been.
  The second finding came from failing to tap a row in the subtitle sheet. Matching its text
  against `'fr'` kept missing, and the reason was that the row's text is `\uF2CCfr`: the icon
  in front of it is a `Text` holding one character from a private-use area, and it is part of
  what the row is called. `@expo/vector-icons` sets nothing to keep its glyphs out of the
  accessibility tree — `create-icon-set.js` has no accessibility handling at all — so every
  control that pairs an icon with a word and does not name itself is announced with an
  unpronounceable character in front of it.
  The earlier accessibility sweep asked whether a control had a name. It did not ask whether
  the name was worth having, and these all had one.
  Named explicitly now, the way this app already names its filter toggles and its upload rows:
  the Download button, the subtitle rows, the folder chips, a failed download's retry row, the
  collection and clip rows, and each of the five tabs — those through React Navigation's
  `tabBarAccessibilityLabel`, which this version maps straight to the name.
  Verified by sweeping for private-use characters in every control's accessible name across
  every screen and the sheet: nothing left. The names now read "Download", "Subtitles off",
  "Remove from liked", "Off", "en", "fr".
  The harness library gained a second subtitle track (`feature.fr.vtt`) so the sheet can be
  opened at all — with one track the button toggles instead, which is why the sheet had never
  been seen. Incremental scanning meant the video had to be touched before the new sidecar was
  noticed.
  Verified green: typecheck 4/4, `pnpm -r test` **378**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: every photo in the library claimed to be zero seconds long.** The
  duration badge on a tile guarded against `<= 0`, and ffprobe reports a single frame as 0.04
  seconds, so every photo carried a badge reading `0:00` — on its tile, under its title on the
  detail screen, and in its row in the Downloads tab. Now nothing under a second is worth
  saying; the clip screens already fall back to tenths where a real sub-second duration matters.
  **3 tests**, control-tested: restoring the old guard fails two of them.
  Galling to find this way. It was in plain sight in readings taken during at least two earlier
  sessions — `0:00 photo` sat in the middle of a string I had already pasted into a summary —
  and it went past me both times because I was looking for something else.
  It surfaced during a deliberate pass at states this app had never rendered in any session,
  which is the same trick that found the icon-glyph naming last time. The harness library grew
  a second repository, a nested folder three deep, a collection with two items in it, and two
  tags, one with a colour and one without. What that made reachable, and what it showed:
  folder chips drilling `All / Films / Shorts / 2024` and narrowing to the one item down there;
  a collection list row reading "Weekend trip, 2 items" and its detail screen holding both; the
  tag filter cutting six items to one and its control renaming itself to "Remove tag filter
  Favourites"; liked-only; photos-only. All correct, and none of it had been seen before.
  One more naming fault from the same pass: a tile announced as `0:08deep`, the duration badge
  running into the title. Tiles now say "deep, 0:08", with the title first because that is what
  identifies the thing, and nothing at all for a photo.
  The "which library?" sheet stays unseen and is now the only screen state in that position:
  reaching it means going through `launchImageLibraryAsync`, which on web opens a file dialog
  that would freeze the session. It needs the phone.
  Verified green: typecheck 4/4, `pnpm -r test` **381**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: what the whole app looks like with the server switched off.** Two
  more states this app had never been in. The first was cheap to arrange and worked exactly as
  written: a clip whose source video is deleted and the library rescanned. Its row in the Clips
  tab says "Source video is gone", is dimmed, and is genuinely not a link — it is absent from
  the list of things a screen reader can activate, while the two healthy clips are there. Its
  detail screen, still reachable by deep link, explains that the media is no longer in the
  library and deliberately offers no Try again, since retrying cannot bring a file back.
  The second needed a small server that serves the built app and destroys the socket for every
  `/api/` call, which is what an unreachable server actually looks like from a phone that
  already has the app installed. A cold start against it, on every screen:
  Browse, Collections, Clips, the media detail of something not downloaded, and a collection's
  contents all say "Cannot reach your server" and offer to try again. **None of them claims to
  be empty** — which is the rule this codebase set itself, and the two screens whose comments
  argue the point at length turn out to be right: the media screen tests `data` rather than
  `isError` and so avoids rendering an empty shell, and the collection does not say it is empty.
  Downloads is correct too, showing its own empty state, since that list is held on the phone.
  One screen fell short. Settings showed "Signed in as —" and "Role —", which reads as though
  the account had gone, when in fact only the request for it had — the server address and the
  storage figures on the same screen are held locally and were as true as ever. It now says so
  in a sentence, and adds that anything downloaded still plays. Checked both ways: offline it
  explains itself, and with the server back it shows "Signed in as admin / Role admin" again.
  Verified green: typecheck 4/4, `pnpm -r test` **381**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: the console has been checked against the wrong build all along.**
  No defect this pass, but a hole in how one class of them was being looked for.
  Every console check in this project has been run against `harness-up.sh`, which exports for
  production — and a production React build compiles its development warnings out entirely.
  Duplicate keys, invalid props, hook-order faults and deprecations all report through
  `console.error` in development and say nothing at all in production. So a console that read
  "83 messages, all the same image error" was never evidence of anything; it could not have
  been. That is the same shape as the empty-glob and empty-directory readings from earlier
  sessions: a quiet answer from a question that was never asked.
  Asked properly this time, with `expo export --dev --no-minify` served in place of the usual
  build. Signed in, walked every screen, mounted the three detail screens that build fresh each
  time, and worked the filters, the folder trail and a tag toggle. **Nothing.** No key warnings,
  no invalid props, no hook warnings.
  Two things about the instrument, both found by probing it rather than assuming. The browser
  extension's console capture reads `console.error` but drops `console.warn` — a deliberate
  probe emitting both saw only the error come back, which matters because React's warnings are
  errors and so do come through, while other libraries' warnings would have been missed
  silently. And a hook installed over `console.warn` from the page covers that gap, but only
  once a probe has shown it is live; the zero above is from a hook proved live first.
  Both are written into the mobile doc, since the trap is one anybody would fall into twice.

- **2026-08-23 — Mobile app: any exception while rendering took the whole app to a blank
  screen.** Expo Router wraps a route in an error boundary only when that route exports one —
  `useScreens` reads `if (ErrorBoundary)` and skips the wrapper otherwise — and this app
  exported none. So an exception thrown during render had nothing to catch it, React unmounted
  the tree, and what was left was an empty root: no message, no way back short of force-quitting.
  Not hypothetical. A version of this app shipped exactly that failure earlier in its life, and
  it was reproduced here from the outside, with no source patched: a proxy in front of the API
  that strips `data` out of the media list, which is a shape a server one version out of step
  could plausibly return. Signing in through it gave `rootChildren: 0` and not one character of
  text. The app trusts every response it gets — nothing validates them at runtime — so it takes
  very little.
  The root layout now exports an `ErrorBoundary`. The same corrupted feed produces "Something in
  the app went wrong", the exception's own message — `Cannot read properties of undefined
  (reading 'id')` — and a Try again. The message is shown rather than something reassuring
  because whoever runs this app also runs the server it talks to, and it is the only thing that
  says which of the two to go and look at. Checked that a healthy server still renders normally
  with the boundary in place: five tiles, no boundary in sight.
  Worth naming as a separate question rather than pretending this settles it: the app validates
  nothing it receives. A boundary means a bad response is survivable instead of fatal, which is
  the right floor, but parsing responses against the schemas `@free-wan/shared` already defines
  would turn "the app crashed" into "the server said something unexpected". That is a larger
  change and a real design decision, so it is left alone.
  Verified green: typecheck 4/4, `pnpm -r test` **381**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: a request that hangs now gives up rather than waiting for the
  platform to.** `fetch` has no timeout of its own, so a phone that drifted off the tailnet
  mid-request sat on a spinner until iOS or Android decided the socket was dead — up to a
  minute, with no error, no retry and nothing to press. The app already knows how to say it
  cannot reach a server; there was simply no way for it to find out. Twenty seconds now, with
  the abort reported as its own error code rather than as an ordinary connection failure.
  Everything that goes through this layer is a database read on the server's side. The two
  things that are genuinely slow do not go through it, which is what makes a cap safe:
  extracting a caption track with ffmpeg is fetched directly in `captions.ts`, and transfers
  are `expo-file-system`'s, with their own progress and their own cancel. Built with an
  `AbortController` by hand, since Hermes has no `AbortSignal.timeout`.
  **2 tests**, control-tested three ways: not aborting, reporting the abort as an ordinary
  failure, and setting the cap so high it could not help all fail. Smoke-checked in the browser
  too, because this is the request layer every screen uses and a signal that misbehaved would
  break all of them — sign-in, five tiles, collections, clips and settings all normal.
  Not checked end to end in the browser: hidden-tab timer throttling makes a twenty-second
  wall-clock measurement worthless, and the path from an `ApiError` to the "cannot reach your
  server" screen was already proved last session against a server refusing connections.
  A test of mine also got through `vitest` while failing `tsc`, which only the workspace
  typecheck caught: a discriminated union whose `ok` had widened to `boolean`.
  Also settled: whether this app should validate what the server sends it. It should not, or
  at least not alone — the web app casts its responses exactly the same way, so trusting the
  server is a decision the product has already made, consistently, and the error boundary added
  last session is the floor that makes it survivable.
  Verified green: typecheck 4/4, `pnpm -r test` **383**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: the library can be sorted.** The server has supported it all along
  — `sort` and `order`, seven orderings including one by like count — and the web app has had a
  control for it since it was built. This app never sent either parameter, so a phone was stuck
  with whatever the server did by default and had no way to ask for anything else. That is a
  gap rather than a decision: nothing anywhere records a reason for leaving it out.
  The same seven, in the same words the web uses, because a library ordered differently in the
  two places would quietly undermine the idea that it is the same library. They live in one
  list in `media.ts` so the two cannot drift apart by accident.
  A sheet rather than an eighth control in the filter row, modelled on the subtitle picker: the
  row already carries a search box and three toggles, and seven choices are more than icons can
  say. The button names the ordering currently in force, since that is otherwise invisible to
  anyone who cannot see which row has a tick.
  Sent only when asked for, so a list that was never sorted still gets the server's own default
  rather than this app's opinion of it. Not offered inside a collection, which the server orders
  by position regardless.
  **4 tests**, control-tested: not sending the parameters fails one, and collapsing the query
  key so orderings share a cache fails seven — that last is the same hazard the filters have,
  where a shared key shows one ordering another's results and the list simply looks wrong.
  Verified in the browser against a real library: Title A–Z came back alphabetical, Title Z–A
  its exact reverse, and Longest put both eight-second videos above the three photos. It holds
  while drilled into a folder and with a media-type filter on top, and the button relabels
  itself to "Sort by, currently Longest".
  Verified green: typecheck 4/4, `pnpm -r test` **387**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: background playback and picture-in-picture were asked for in code
  and absent from the Android build.** Both player screens set `allowsPictureInPicture`, and
  both set `staysActiveInBackground` on the player. Neither worked on Android, and nothing said
  so — the code compiles, the properties are real, and they simply do nothing without the build
  to back them.
  `expo-video`'s own type documentation is explicit about the first: "the
  `supportsBackgroundPlayback` property of the config plugin has to be `true` for background
  playback to work". `app.json` declared the plugin bare. Reading the plugin settled the rest:
  given no options it returns without touching anything, and what it would have added is the
  iOS background mode, and on Android the `ExpoVideoPlaybackService` with a `mediaPlayback`
  foreground service type, the `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
  permissions, and `android:supportsPictureInPicture` on the main activity.
  Checked against the generated `AndroidManifest.xml` rather than inferred: none of the three
  was there. With the options set and the native project regenerated, all three are.
  iOS was already declaring `UIBackgroundModes: ["audio"]` by hand in `app.json`, which is why
  background audio worked there and not on Android. That hand-written entry is now gone and the
  plugin owns it, so the two platforms are configured from one place instead of one of them
  being remembered and the other forgotten. Confirmed by introspecting the iOS config, which
  reports `UIBackgroundModes: ['audio']` among 28 keys — a count worth printing, since an empty
  introspection would otherwise read exactly like a pass.
  Both remain device-only to actually watch working, and are on the checklist.
  Verified green: typecheck 4/4, `pnpm -r test` **387**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: the rest of the build configuration audited, and one security note
  that was missing.** Last session found two capabilities the code asked for and the build never
  granted, so the same question was put to everything else in `app.json` and the generated
  manifest.
  What holds: the `freewan://` deep link is declared with the VIEW, DEFAULT and BROWSABLE
  filter it needs. The now-playing notification turns out to have been broken on Android for
  the same reason picture-in-picture was, and the same fix covers it — its documentation says
  it too needs `supportsBackgroundPlayback`. It does not need `POST_NOTIFICATIONS`: media
  session notifications are exempt from Android 13's runtime permission, which is why Expo's
  own plugin adds only the two foreground-service permissions.
  A claim in `docs/13-security.md` was checked rather than trusted, since the manifest had just
  been regenerated: the session token is excluded from Android backups. It is, and by more than
  the manifest pointing at rule files — `expo-secure-store` ships both, and they exclude its
  store from cloud backup *and* device-to-device transfer. The app's own module has no
  `res/xml` at all, which looks like the claim failing until you notice the resources merge in
  from the library.
  What was missing from that document is now in it: Android permits cleartext, so the bearer
  token can travel in a header over a plain LAN. Over a tailnet this costs nothing, since the
  wire is encrypted whatever the scheme says, and the documented deployment terminates a real
  `https://` anyway. iOS will not do the same thing — its local-networking exception covers
  private LAN ranges, and Tailscale's addresses are not among them — so a plain-HTTP tailnet
  server an Android phone reaches would be refused by an iPhone. Recorded, not tested.
  Noticed and left alone: `expo-font` is declared as a plugin with nothing to embed and does
  nothing at build time. The package itself has to stay — `@expo/vector-icons` loads its icon
  fonts through it. And the splash screen's colour is baked into the build, so it cannot follow
  a server's branding; a light preset flashes dark for as long as the splash lasts.

- **2026-08-23 — Mobile app: three of the device checklist's steps cannot be done in Expo Go,
  and the checklist did not say so.** The whole device run has been framed around scanning a QR
  code, which points at Expo Go — and Expo Go is a prebuilt app carrying its own `Info.plist`
  and `AndroidManifest.xml`. Nothing a config plugin writes reaches it. So background playback,
  picture-in-picture, the lock-screen controls and `freewan://` links are all absent there
  whatever `app.json` says.
  That matters more than it would have a week ago: two sessions back those very capabilities
  were found missing from the build and fixed. Someone testing them in Expo Go would watch them
  fail and reasonably conclude the fix did not work, when what they were running could never
  have shown it either way.
  The checklist now says which three need a real build and why, and has grown the two steps
  those fixes deserve — leaving the app with a video playing and locking the phone, and sending
  it to a picture-in-picture window — plus one for following a `freewan://` link, since Expo Go
  answers only to its own scheme. Sixteen steps now, still ordered by what would be worst if it
  were wrong, and the rest still behaves identically either way.
  Renumbering that list took three attempts and is worth a line of its own: the first pass
  renumbered the digits inside the text it had just inserted, and the second cut the list short
  by treating its own preamble as the end of it. Both were visible immediately in the output —
  a list running 7, 14, 15, 16, 8 — which is the only reason they did not survive.

- **2026-08-23 — Mobile app: a slow server could yank a viewer out of a video they had already
  started.** Found by reading back the media screen as a whole rather than as a diff, which is
  something none of this session's changes had had done to them.
  The flaw was one I put there myself. `resumeSeek` waits for the playback query before
  deciding where to start, which is right — a downloaded file is ready to play before the
  server answers, and deciding early would mean never resuming a download. But the wait had no
  end. On a server that is slow rather than unreachable, the local video starts at zero, the
  viewer watches, and ten or twenty seconds later the answer arrives and the playhead jumps to
  wherever they had got to last time. Before downloads were given a resume position at all,
  two sessions ago, this could not happen; giving them one is what opened it.
  The rule now expires: past five seconds of actual playback, the decision is still made — so a
  later answer cannot come back and try again — but nothing moves. Whatever they were watching
  is what they chose, and they did not ask to go anywhere.
  **3 tests**, control-tested three ways: removing the grace period fails the case it exists
  for, returning "undecided" instead of "decided, do nothing" fails two, and a grace of zero
  blocks the ordinary resume that a healthy server answers in a fraction of a second.
  Verified green: typecheck 4/4, `pnpm -r test` **390**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: a full phone made one download appear as both finished and
  failed.** Found by reading `downloads.ts` as a whole rather than as three separate diffs,
  which is how this session had been changing it.
  Writing the index back is the last thing a finished transfer does, and it happens *after* the
  record has been published. So a rejection from that write landed in the catch that records
  failures, and the item ended up in two of the three collections the Downloads tab
  concatenates — the same key on screen twice, offering to retry something it was at the same
  moment offering to play. `getDownloadState` reads the index first, so the media screen said
  "Available offline" while the Downloads tab said it had failed.
  What makes this worth more than its narrowness suggests: the write fails when the phone is
  out of room, and this app is the thing that fills it. Storage exhaustion is not an exotic
  condition here, it is the expected end state of using the feature.
  Fixed at the root by making the write best effort. It was throwing into three places and
  helping in none: in `hydrate` and `removeDownload` a rejection skipped the notification that
  tells the screens to re-read, so the list stopped matching what the app held. What is given
  up is small and honest — a record that cannot be written does not survive a restart, and the
  sweep added earlier reclaims the file it pointed at.
  The first attempt at the test proved nothing and said so loudly enough to notice: the
  test-only snapshot exposed active and finished ids but not failures, which is precisely the
  pair the invariant is about. Extending it to all three turned a passing test into one that
  reported `doneIds: ["media-1"]` alongside `failedIds: ["media-1"]`. The invariant it guards
  is now the real one: an item appears in exactly one of the three lists.
  Verified green: typecheck 4/4, `pnpm -r test` **391**, `pnpm -r build`, both bundles.

- **2026-08-23 — Mobile app: two smaller things from reading `branding.ts` and the Browse
  screen whole.** Both were found the same way as the last two sessions' defects — by reading a
  file as it now stands rather than as the diffs that got it there — and both are smaller than
  what that turned up before, which is itself worth recording.
  The first is a contract that was not true. `startBranding` says its `onSettled` "fires once",
  and two things race to call it: the two-second cap, and the first fetch finishing. Whichever
  arrives second called it again. Harmless today, because the only caller sets a boolean React
  already ignores when unchanged — but the sentence was in the docstring, and the next caller
  might hide a splash screen or record a first paint with it. No test covered the case: the one
  that exercises the cap uses a fetch that never resolves, so the second call could not happen.
  A test for the sequence that does it — a server answering *after* the cap — failed against the
  old code with "expected 1 times, but got 2", and the fix is a flag.
  The second is waste rather than error. Tags are held in the order they were tapped and go
  into the cache key as given, so the same two tags chosen in the other order are a different
  key and a second trip for results already held. Toggling one off and back on is enough, since
  that moves it to the end. They are sorted before they reach the key now, which is exactly the
  argument made for patching likes into the cache instead of refetching: a phone's link to its
  own server is not free. **5 tests** across the two, both control-tested.
  Verified green: typecheck 4/4, `pnpm -r test` **395**, `pnpm -r build`, both bundles.

### Do not re-render the library because something is downloading

The download store notifies every subscriber from one place, and one of the callers of that
notification is `expo-file-system`'s progress callback — which fires per chunk written, so many
times a second for a video over a fast link. Two readers took that notification and did more
with it than they needed to.

`useDownloads` returns a fresh array of every record and every transfer on each notification, so
storing it always re-renders. The Browse screen was calling it for one number: how many finished
downloads there are, used to say — when the library cannot be reached — how much is still
playable without it. So starting a download and going back to browse, which is the flow this app
is built around, re-rendered the search field, the folder chips and the grid once per chunk.
`MediaTile` is memoised against exactly this hazard coming from typing; this was the same hazard
from a different direction. Browse now reads `useDownloadCount()`, which sets a number: unchanged,
React bails out of the render itself.

`useDownloadState(id)` had the same shape one level down. `getDownloadState` builds a new object
every call, so a screen showing item A re-rendered on every chunk of item B to arrive at the
`{status: 'none'}` it already had. It now compares the two readings and keeps the old one when
they say the same thing.

2 tests, control-tested three ways: counting in-flight transfers in `countDownloads`, dropping
the progress comparison, and comparing states by identity — which is what the old code
effectively did — each fail the new tests.

Verified green: typecheck 4/4, `pnpm -r test` **397** (180 backend + 204 mobile + 11 web +
2 shared), `pnpm -r build`, both Hermes bundles.

### A failed download you cannot get rid of

The Downloads tab lists failures above everything else, on the stated grounds that they need a
decision — and offered exactly one: retry. That is the right decision when the phone dropped off
the tailnet mid-transfer, which is the case the failure state was written for. It is the wrong
one when the media has been deleted from the library, or that server is not coming back. Retry
then fails again, and the row holds the top of the tab in front of the downloads that do work,
for the rest of the session.

`removeDownload` already had `delete failures[id]` in it, and it could never run: the early
return above it required a record in the index, and an item with a record is not a failure. So
the guard now admits either, the delete of the files is skipped when there is nothing on disk,
and `FailedRow` grew a cross beside the retry area — the same two-control shape a finished
download's row already had. No confirmation on it, unlike the trash on a finished download,
because nothing is deleted: the partial file went when the transfer did, and the item is still
in the library to download again.

3 tests. The first two control-tested by restoring the record-only early return. The third —
that dismissing does not stop a retry already in flight — needed a second attempt: the obvious
control (clearing `active` as well) passed, because the early return fires first during a
transfer and the mutation was unreachable. Removing the guard *and* clearing `active` reaches
it, and fails the test.

Also corrected a doc line that had said "Three behaviours worth knowing" over a list of four.

Verified green: typecheck 4/4, `pnpm -r test` **400** (180 backend + 207 mobile + 11 web +
2 shared), `pnpm -r build`, both Hermes bundles. Not verified on a device — the Downloads tab's
cross and Stop controls are among the few things the browser harness cannot reach, since it
cannot download anything to fail.

### The one request that could hang was the one with nothing else on the screen

`api.ts` grew a twenty-second timeout because `fetch` has none, and without one a phone that
drifts off the tailnet mid-request sits on a spinner until the platform gives up on the socket —
a minute on iOS, with no error and nothing to press. Signing in never got it. It cannot go
through `request`, because it has to build its URL from an address that has only just been typed,
before there is a session to read one from, so it called `fetch` directly. The result is the
worst placement of that defect available: the login screen is the one screen in the app with
nothing else on it, and an address that resolves to something which is not your server, or to a
machine that is asleep, is exactly the mistake made there.

The timeout is now `fetchWithTimeout`, which `request` calls and login calls. Nothing about the
limit changed.

Two behavioural tests on the wrapper called the way login calls it, and one that reads the
source: any file under `src` or `app` calling a bare `fetch` fails it, with `api.ts` and
`captions.ts` named as exemptions — the implementation, and a deliberate one where a caption
track may need ffmpeg and where failing costs the captions only. That last test is the shape
that would have caught this: nothing failed here, the request simply never finished, which no
ordinary test notices.

Two controls to note, because both were wrong on the first attempt and passed:

- Reversing the spread in `fetchWithTimeout` (`{signal, ...init}`) passed, because no caller
  passes `signal: undefined` — the hazard is unreachable. Removing the signal outright, and
  dropping `init`, are reachable and both fail the tests.
- The mock in the new test typechecked as taking no arguments, so `mock.calls[0]![1]` was
  `undefined`. Vitest passed; `tsc` caught it. Same as before: green tests are not the whole
  check.

Verified green: typecheck 4/4, `pnpm -r test` **403** (180 backend + 210 mobile + 11 web +
2 shared), `pnpm -r build`, both Hermes bundles.

### An hour listened to with the screen off, reported as the minute it was locked

Two features of this app meet badly. A video keeps playing when the phone is locked — that is
the point of `staysActiveInBackground` and the lock-screen controls — and playback position is
reported to the server so the web app and this app resume in the same place. The reporting ran
on a `setInterval` and on leaving the screen, and neither of those is something a backgrounded
app can count on. So an hour of listening with the screen off could be recorded as the minute
before the phone was locked, and opening the same video on the web app would start it an hour
early.

The hole was already known here in a sideways form: `resumeSeek`'s own docstring names "the
whole stretch of background playback, if the reporting timer was suspended while the audio kept
going" as a reason not to follow the server's position blindly. That defends against the
symptom. This closes the source: a position is now reported on every app-state transition. The
reading on the way out records where the phone was locked; the reading on the way back records
where playing on regardless got to, and that second one is the one that matters.

Reports arriving on every transition makes the send guard load-bearing in a way it was not
before — pulling a notification shade down and up must not become two requests — so it is now
`shouldReport`, split out and tested the way `resumeSeek` was, for the same reason. 7 tests,
control-tested three ways: dropping the per-item scoping, dropping the `Math.abs` so a backwards
seek never reports, and dropping the finite check.

What is *not* tested is the wiring itself — that `AppState` fires the report — because that
needs a renderer this package does not have. And whether a JavaScript timer keeps running in a
backgrounded app with audio playing is platform behaviour I cannot check from here: the fix is
correct either way, since an unchanged position is discarded, but which of the two happens is
now part of step 7 of the device checklist.

Verified green: typecheck 4/4, `pnpm -r test` **410** (180 backend + 217 mobile + 11 web +
2 shared), `pnpm -r build`, both Hermes bundles.

### Subtitles were re-rendering the whole media screen four times a second

The playhead used for caption timing was state on the media screen, fed by a `timeUpdate` event
every 250 ms. So while subtitles were on — which is the whole length of a subtitled film — every
tick re-rendered that screen: the video view, the poster, the title, the tags, the download
button, the like button, the subtitle picker and the scroll view around them, to change one line
of text inside an absolutely-positioned overlay.

The cost was already half-recognised. The event interval was set to 0 when no track was chosen,
with a comment saying that leaving it on "would re-render this whole screen ... four times a
second for the sake of subtitles nobody asked for". True — and equally true of subtitles somebody
did ask for.

`CaptionOverlay` now takes the player instead of a time, subscribes itself, and keeps the *cue*
rather than the clock. Two consequences. Nothing above it re-renders at all, because the state
that changes lives inside it. And it re-renders once per subtitle line rather than four times a
second, because `cueAt` returns the cue out of its array rather than building one — so between
two ticks inside the same line React is handed the value it already holds and stops there. The
overlay also owns the event interval now, and asks for it only while a track is actually showing
something: a track still loading, or one that would not parse, costs nothing.

3 tests on the identity that makes it work, control-tested by having `cueAt` return `{...cue}`.
The re-render counts themselves are not tested — that needs a renderer this package does not
have — so what is asserted is the property the saving rests on, not the saving.

Verified green: typecheck 4/4, `pnpm -r test` **413** (180 backend + 220 mobile + 11 web +
2 shared), `pnpm -r build`, both Hermes bundles. Subtitles cannot be seen in the browser harness
— `expo-video` never requests the stream there — so this is another one for the device run.

### Downloads could be stopped; uploads could not

The Downloads tab has had a Stop from the start, with the reasoning written down beside it: a
phone on a metered connection needs a way out of a multi-gigabyte transfer it started by
mistake. Nothing made that argument in the other direction, and it is stronger there. A phone's
uplink is the slower half of its connection, picking the wrong thing out of a camera roll takes
one tap, and the batch limit is fifty files — so an upload begun by accident could not be
stopped short of killing the app.

`uploadFile` now hands the running transfer back through an `onTask` callback, which is all the
library needed; the batch itself is the component's business, so that is where Stop lives. It
cancels the file in flight and abandons the queue behind it. The file that was going up when
Stop was pressed comes back as a failure, because the transfer really did not finish — but it is
not reported as one, because telling someone the thing they just asked for went wrong is the kind
of small lie this app keeps refusing to tell.

That decision is now `batchSummary`, split out and tested the way `uploadBlocker` was. 7 tests,
control-tested three ways: letting a stop fall through to the failure path, listing more than
five rejections, and dropping the singular case.

Verified green: typecheck 4/4, `pnpm -r test` **420** (180 backend + 227 mobile + 11 web +
2 shared), `pnpm -r build`, both Hermes bundles. Not seen working: uploads need a picker and a
real file, so the browser harness cannot reach this — the same gap the Downloads tab's Stop has.
It belongs on the device run.

Also worth recording: the re-render sweep this pass was deliberate rather than incidental, and
it came back clean. The only remaining handler firing at 4 Hz is the clip screen's `timeUpdate`,
which sets no state at all, and both `statusChange` handlers write values React bails on. Three
findings in that family and it is done.

### A pass spent checking rather than changing

Every request layer test in this package drives a stubbed `fetch`, and `api-contract.test.ts`
proves a path exists in the routes source. Neither proves the server answers. So this pass ran
the mobile app's whole API surface against a live server on port 8180, signing in the way the
app does — `client: "native"`, a 43-character bearer token, and every subsequent request
carrying it as a header rather than a cookie. That auth path had never been exercised end to end
outside a stub.

Everything answered: branding, me, the media list under four different filter and sort
combinations, categories, tags, collections, clips, upload targets, one item's detail, playback,
poster, progress with and without a duration, and like and unlike. The three rejections the app
depends on all came back 422 — a negative position, a zero duration, and a sort value that is
not one of the seven.

The photo fitting was measured rather than argued for the first time. On a 1600x1200 photo the
original is 110 KB and the fitted 1280 an iPhone asks for is 60 KB. The more interesting number
is the other branch: asking for 2560 on that same photo returns **164 KB**, half again as large
as the original and no sharper, which is exactly what `displayWidthFor` returns null to avoid.
A tablet is what would ask for it, and `supportsTablet` is on. That figure is now in the
docstring beside the claim it supports.

Not done, and worth being plain about: the browser extension would not connect this session, so
none of the four screens changed over the last few passes has been *looked at*. The dev bundle
was exported and served, and the API was up, but the check itself did not happen. What can be
established by reading — that no hook in any changed component sits after an early return, which
is the fault a dev bundle would catch — was established that way instead.

### A colour the server accepts that the phone could not read

`packages/shared/src/branding.ts` allows 3, 6 **or 8** hex digits for every one of the five base
colours, so an admin can set one with an alpha channel and the server stores it without
complaint. The web app copes, because CSS `color-mix` understands the eight-digit form. The
mobile palette did not: `parseColor` matched 3 or 6 digits only.

The way it failed was not subtle. `mix` returns its first argument when it cannot parse, on the
reasoning that a bad colour should cost one token rather than the whole app's chrome — but here
nothing was bad, and the first argument is the text colour. So on the `linen` preset with its
text written as `#241f18ff`, three derived tokens all came out as near-black: `surface-2`, which
is every tile backdrop, every progress track and every poster placeholder; `border`, where an
eleven-percent wash belongs; and `muted`, which is every secondary line of text on every screen,
at full strength. On top of that `isLight` answered false for a cream background, pointing the
status bar and the keyboard at a dark scheme over a light app — the exact half-applied look
`syncColorScheme` was written to prevent. This was confirmed by running it before changing
anything, not reasoned about.

`parseColor` now reads all four hex lengths and the alpha in `rgba()`, `mix` composites with the
channels premultiplied — which is what `color-mix` does by default, so the two apps still agree —
and `withAlpha` multiplies the source alpha rather than replacing it. Two opaque colours mix
exactly as before, so none of the seven shipped presets moves.

7 tests, control-tested four ways: restoring the 3-or-6 regex, accepting every length in the
3..8 range, mixing without premultiplying, and letting `withAlpha` discard the source alpha.
Each fails on the assertion it should.

Two of my own expected values in those tests were wrong and the run caught them — a made-up hex
literal for an opaque mix, and an equality that compared the base colours as well as the derived
ones when only the derived ones have to agree.

Verified green: typecheck 4/4, `pnpm -r test` **427** (180 backend + 234 mobile + 11 web +
2 shared), `pnpm -r build`, both Hermes bundles.

Still blocked: the browser extension would not connect again this pass, so the four screens
changed over recent passes remain unlooked-at.

### White text on a green button, at 2.5:1

`derivePalette` returned `onPrimary: '#ffffff'` with a comment saying it was "fixed in the web
tokens too". The web app has never fixed it — `applyBrandingVars` derives it from the primary's
luminance — and on two of the seven shipped presets it derives the opposite. That comment is why
nobody looked: five presets happen to want white, so the wrong ones were never the ones checked.

Measured across all seven, white against each primary:

| preset | primary | white | dark | web chose | mobile chose |
|---|---|---|---|---|---|
| midnight | `#6e4cff` | 5.07 | 3.68 | white | white |
| slate | `#5b8def` | **3.23** | 5.79 | white | white |
| forest | `#3fb873` | **2.53** | 7.40 | dark | **white** |
| ember | `#ff7a3c` | **2.59** | 7.21 | dark | **white** |
| neon | `#ff2e88` | **3.50** | 5.34 | white | white |
| paper | `#b8442b` | 5.38 | 3.47 | white | white |
| linen | `#1f6f5c` | 6.02 | 3.10 | white | white |

Two separate faults. Mobile disagreed with the web on `forest` and `ember` and landed at 2.53:1
and 2.59:1 — under even the 3:1 that large text needs — on the Sign in button, the Change
password button and the floating upload button. And the web's own rule was wrong on `slate` and
`neon`, which it gave white at 3.23:1 and 3.50:1 where dark reaches 5.79:1 and 5.34:1.

The web rule was the same mistake `isLight` already carries a comment about: it averaged the raw
gamma-encoded channels and thresholded at 0.55, which is a number on the wrong scale. Both apps
now use the WCAG relative luminance and the crossover at 0.1791, so all seven presets agree and
every one lands at 5.07:1 or better. `UploadButton` was also painting `#fff` directly on the
primary in three places, bypassing the token; it uses `onPrimary` now.

**This changes the web app's rendering**, which is worth stating plainly rather than burying: the
primary button label goes from white to `#15120c` on `slate` and `neon`. That was not asked for,
but the whole claim in `palette.ts` is that a preset resolves to the same values in both apps,
and fixing only the phone would have left them disagreeing on a different two presets instead of
the same two.

4 tests on mobile asserting contrast rather than hex values, plus one on the web pinning the
seven answers so the two cannot drift apart silently. Control-tested five ways: unconditional
white, unconditional dark, deciding from the background instead of the primary, the old
midpoint-of-the-scale threshold, and reverting the web to 0.55.

`tsc` caught a duplicate import that vitest was happy with — the third time this session that
green tests were not the whole check.

Verified green: typecheck 4/4, `pnpm -r test` **432** (180 backend + 238 mobile + 12 web +
2 shared), `pnpm -r build`, both Hermes bundles. The colours themselves have not been *seen* —
the browser extension has now failed to connect three passes running.

### The primary colour where it is read rather than filled

Comparing the mobile palette against the web's token block turned up three derived tokens the
phone never got: `--fw-primary-strong`, `--fw-primary-line` and `--fw-accent-tint`. The first
carries a comment saying why it exists — the raw primary lacks AA contrast against its own tint,
so anything drawn *as text or as an icon* rather than as a fill needs the primary pushed towards
the text colour. The phone used the raw primary in both such places.

Measured across the seven presets, worst case is `midnight`, which is the default:

- the current folder's name in the category row: **3.87:1** on the background, at 13px bold —
  which WCAG counts as normal text, so it wants 4.5:1
- the icon in an active filter chip: **3.45:1** on the primary's own 15% tint

The icon clears the 3:1 that graphical objects need, so it is not a failure; the folder name
does not. `primaryStrong` is now in the palette as `mix(primary, text, 0.6)`, mirroring the web
exactly, and both places use it. Every preset now clears 4.5:1 in both spots.

`primaryLine` and `accentTint` were deliberately left out. The first would only change a border
from full-strength to 40%, which is cosmetic and not a legibility question; the second has no
element on the phone that uses it, and an unused token is the kind of speculative addition this
project keeps declining.

5 tests asserting ratios rather than hex values, control-tested three ways: leaving it as the raw
primary, pushing it all the way to the text colour, and only going 15% of the way.

**Found and not fixed:** the web app's category bar has the same 3.87:1 on `midnight` — it uses
`font-semibold text-primary` for the current crumb, though `--fw-primary-strong` exists for
precisely this. That is a web change, and there is already one unrequested web change from the
previous pass awaiting a view, so it is reported rather than made.

Two process notes. A patch script opened `test/palette.test.ts` in write mode and truncated it
when the write itself then failed; restored from git and the tests appended directly instead.
And `pnpm -r test` failed once in the API package, 114 of 180, then passed 180/180 on four
subsequent runs including a full recursive one — the API suite spawns real servers and the
update-reconcile test alone takes over three seconds, so contention under the recursive run is
the likely cause. Recorded because a test that fails once is still a flaky test, not nothing.

Verified green: typecheck 4/4, `pnpm -r test` **437** (180 backend + 243 mobile + 12 web +
2 shared), `pnpm -r build`, both Hermes bundles.

### Signing in threw away where you were going

`login.tsx` finished with `router.replace('/')`, and nothing anywhere recorded an intended
route. Two ordinary situations ended badly because of it. Following a `freewan://` link to an
item while signed out — a first install, or a link from someone else — opened the library.
And a session expiring mid-use ends the same way: the 401 clears the session, the gate sends you
to sign in, and signing back in drops you at the library rather than the video you were halfway
through. Deep links are one of the two things that were asked for under "native feel", and step
9 of the device checklist.

This app has met the same loss before from a different direction. `useBranding`'s docstring
records a remount discarding a deep link "a moment after it arrived", and the whole shape of that
hook exists to avoid it. The cause was fixed; this second cause was not.

The gate now owns it, which is where it belongs — it is the thing that knows whether the password
still has to be changed and what was being asked for. `gateRedirect` takes a `pendingRoute` and
returns it instead of `/` when it releases a gate screen; the effect in the root layout remembers
the path as it redirects to sign-in, keeps it across a forced password change, and drops it once
used. `login.tsx` no longer navigates at all — doing both raced, and the library appeared for a
frame on the way elsewhere.

7 tests, control-tested three ways: always returning `/`, allowing a gate screen as a
destination, and accepting any string. The existing fixed-point property test — that no
destination immediately redirects again — was extended to cover a destination that can now be any
route.

One of the new tests failed on the first run and was right to: `//elsewhere.example` passes a
bare `startsWith('/')` and would have been returned as a destination. It is a protocol-relative
URL, not a route of ours. Guarded.

**Noted, not changed:** `app.json` lists the `expo-font` plugin and nothing uses it — there is no
`useFonts`, no `assets/fonts`, and the docs say plainly that admin-chosen fonts are not followed.
It is probably inert, since autolinking covers the native module either way, but "probably inert"
is not something worth acting on blind for no gain.

Verified green: typecheck 4/4, `pnpm -r test` **444** (180 backend + 250 mobile + 12 web +
2 shared), `pnpm -r build`, both Hermes bundles. Not seen working: deep links need a real build,
and the browser extension has now failed to connect four passes running.

### Auditing the preset where the answer actually changed

Two passes ago the on-primary rule was changed in both apps, and the reasoning was arithmetic:
white on `slate` and `neon` reaches 3.23:1 and 3.50:1, the dark half reaches 5.79:1 and 5.34:1.
What was never done was running the e2e suite afterwards. That was a real gap — the suite ends
with six axe WCAG A/AA audits, and colour contrast is one of the things axe checks.

Running it: 18 of 18 green. But that proves less than it looks. Every audit runs on the default
`midnight` preset, where the primary is dark enough that white was always the right answer — the
change is a no-op there. Which is exactly why the rule was wrong for so long without anyone
noticing: five of the seven presets want white, and the default is one of them.

So a nineteenth flow now applies `slate` in the branding editor and audits both that page and the
library under it. Reverting the web app to its old rule and re-running turns it red, with axe
reporting a **serious** `color-contrast` violation on five separate elements — the active preset
button, a primary button, a badge and two more. An independent auditor now says the old
behaviour was a real violation and the new one is not, which is a much better footing than my own
contrast arithmetic.

Kept last in the file, since applying a preset is a persistent change to the site's branding.

**Noted, not changed:** `CaptionTrack.default` is in the shared schema, sent by the API and
consumed by the web app's `<track default={...}>`, but the server hardcodes it to `false` for
every track — so the mobile app ignoring it costs nothing today. Dead plumbing across three
packages rather than a mobile defect. And `ApiError.code` is captured on every failure and read
nowhere; the message is what screens show.

Verified green: typecheck 4/4, `pnpm -r test` **444**, `pnpm -r build`, both Hermes bundles, and
`pnpm test:e2e` **19 passed**.

### Light mode had never been rendered by any test, and it was hiding a real one

Last pass established that the e2e audits all ran on the default preset, and added one under
`slate`. The same reasoning applies harder to the light presets: light mode is not a variation
on dark, it is the background and the text swapping roles, so every derived token lands somewhere
else. No flow in this suite had ever rendered it.

Adding one under `linen` failed immediately, with three colour-contrast violations. Following
them found a defect on the phone, which is the part that mattered:

**`linen`'s accent is 3.44:1 against its own background**, and the mobile app used it as 14px
semibold text — the "Available offline" line on the media detail screen, which is the label every
downloaded item shows. That is under the 4.5:1 normal text holds to. Every other preset is
comfortable (9.24 to 14.28), which is why it survived: six of seven presets hide it, and the
default is one of the six. The same shape as the on-primary defect, found the same way.

The tick keeps the accent — an icon is a graphical object and holds to 3:1, which all seven
clear — and the words now use the readable token. Deliberately *not* by adding an `accentStrong`
to match `primaryStrong`: the web has no such token, so inventing one here would split the two
token sets apart for the sake of a single label, and this file exists to keep them together.

2 tests. One pins that the accent clears 3:1 everywhere, which is what makes the icon acceptable.
The other asserts the fact that motivates the restriction — that exactly `linen` fails 4.5:1 —
written as a list of preset names, so if that ever stops being true the test says so rather than
silently passing.

The e2e flow audits the library and the watch page under `linen`. It deliberately does not audit
`/settings/branding`, and says so in the test: the three violations there are all inside the
editor's own preview panel, including a pill that paints `--fw-bg` on `--fw-accent` to show what
the pair looks like. A swatch that demonstrates a colour necessarily shows that colour, and axe
cannot tell one from a label. Whether to change them is a design decision for that page, not
something to settle by widening a test — and it is the second web-side finding now waiting on a
view.

Verified green: typecheck 4/4, `pnpm -r test` **446**, `pnpm -r build`, both Hermes bundles,
`pnpm test:e2e` **20 passed**.

### The worst contrast in the app was on its error messages

Following the light-preset work one step further — measuring every token that is ever drawn as
text against every preset's background and surface — turned up `danger`, which was fixed at
Tailwind's `red-400`. It was copied from the web app, which writes `text-red-400` in twenty-nine
places.

A fixed light red cannot serve a light app. On `paper` it is **2.34:1** against the background
and on `linen` **2.41:1** — lower than the accent case found last pass, lower than the
on-primary case before it, and the lowest contrast anywhere in this app. It is also on the text
that most needs reading: six places draw it as words, among them the Sign out button, the login
error, a failed download on two separate screens, a clip whose source is gone, and the crash
screen.

There is no single value that works. `red-400` clears 6.42:1 on all five dark presets and fails
both light ones; `red-700` is the exact mirror; `red-600`, the nearest thing to a compromise,
still only reaches 4.09:1 on `paper`. So it is chosen by background lightness, the same shape as
`onPrimary`. Every preset now clears 4.5:1 on both the background and a surface.

Four hardcoded `rgba(248,113,113,…)` literals went with it — the error box on two screens and
the borders on Sign out and a failed download. They were the same red written out by hand, and
a fixed light-red wash under dark-red text is precisely the mismatch this was about. They derive
from the token now.

3 tests, control-tested four ways: one fixed light red, one fixed dark red, the text colour on
light presets (readable, but no longer a warning), and `red-600` as a compromise. Each fails.
The second test is the one worth keeping an eye on — it asserts the colour is still recognisably
red, because a colour dark enough to read is no use if it stops reading as a warning.

**The web app has the same defect and is not fixed here.** `text-red-400` in twenty-nine places
is a much larger change than the one-line token this was on the phone, and it is the third
web-side finding now waiting on a view. The e2e audit does not catch it because no error state is
rendered on the pages it visits under `linen`.

Verified green: typecheck 4/4, `pnpm -r test` **449**, `pnpm -r build`, both Hermes bundles,
`pnpm test:e2e` **20 passed**.

### Closing the seam three defects came through

Three contrast defects have been found over the last few passes, one at a time and all by hand:
the primary as the current folder's name at 3.87:1 on the default preset, the accent as the
"Available offline" label at 3.44:1 on `linen`, and the error red on the Sign out button and
every error message at 2.34:1 on `paper`. Each survived for the same reason — five or six of the
seven presets are comfortable, and the default is one of them.

Nothing could have caught them. `tsc` is satisfied by any string. The palette tests prove a
*token* is readable but not that a readable one is what got used. And the web app's equivalent
check is an axe audit in a real browser, which this package has no renderer for.

`test/text-colours.test.ts` reads the source instead. It finds every `color:` in a style object —
lower-case `c` on purpose, since `backgroundColor`, `borderColor` and `tintColor` all capitalise
it — and asserts that each one is either a token whose contrast is proven against every preset in
`palette.test.ts`, or a fixed colour in a file that also fixed what sits behind it. There are
three of those: the duration pill, the playback error overlay and the caption plate, each white
on a black this app painted, where no preset can reach.

Four checks. One is that the scan found more than thirty uses at all, because a silent empty
result would pass everything having read nothing. One is that every exemption still has a use
behind it and a stated reason, since an exemption list that outlives its reasons is how a check
like this stops meaning anything.

Control-tested by reintroducing two of the three original defects — the accent label and the
primary folder name — and by moving a fixed white into a file with no exemption. Each fails.

Verified green: typecheck 4/4, `pnpm -r test` **453**, `pnpm -r build`, both Hermes bundles.

### A row that never said it was a link, and two things checked and found fine

The Downloads tab lists finished downloads as a `Link` wrapping a `Pressable`, and alone among
the four screens that list things it gave that Pressable neither a role nor a name. React Native
makes a Pressable an accessibility element unless told otherwise, and builds an unnamed element's
name from its children — so the row announced as its title and its size run together, and never
said it was a link at all. Every other list in the app names its rows, with a comment in
`MediaTile` explaining why. This one was missed.

Fixed, and then guarded: `test/pressables.test.ts` reads the source for every `<Pressable`, parses
its opening tag by counting brace depth — a style prop is an arrow function returning an object,
so a naive scan for `>` ends the tag on the fat arrow — and requires each one to carry a role or
an explicit `accessible={false}`. A second check requires a label wherever the children would not
read, with the six exceptions listed by file rather than counted: each is a control whose only
child is a plain `Text` saying exactly what it does, where a name would be the same words twice.

Control-tested by removing the role and then the label from the row just fixed. Both fail.

Two things were checked this pass and found fine, which is worth recording so they are not
checked again:

- **Large system font sizes.** No `Text` in this app sits in a container with a fixed height, and
  nothing overrides `allowFontScaling`, so text grows with the phone's setting and every
  container grows with it. That is the correct behaviour and it was already there.
- **Non-text contrast on controls**, WCAG 1.4.11, which wants 3:1 for the visual boundary of a
  user-interface component. Measured: `border` against what it sits on is 1.24–1.34:1 across the
  seven presets, and `surface` against `bg` is 1.07–1.18:1. So a text input, a chip or a card is
  delineated by neither its edge nor its fill at that threshold.

That last one is **reported and deliberately not changed**. It is identical in the web app —
`--fw-border` is the same 11% mix — and it is the visual signature of the whole design rather
than an oversight. Bringing it to 3:1 means every border in both apps roughly three times
heavier, which is a redesign and the user's call, not a defect fix to make unilaterally. axe does
not flag it, which is why the browser audits pass.

Verified green: typecheck 4/4, `pnpm -r test` **456**, `pnpm -r build`, both Hermes bundles.

### Correcting the document that says what this app does

This file has been added to on nearly every pass, and the mobile doc alongside it. Reading the
latter whole found four claims that used to be true and are not any more — every one of them
made false by a change made here, which makes it this session's mess rather than anyone else's.

- "Two things are deliberately left alone" listed the subtitle plate and the duration pill.
  There are three: the message shown when a video will not play is fixed white on a dark scrim
  too, and has been since it was written. The sentence now names all three and points at the
  test that holds the app to exactly that list.
- "the two things that are only icons — the cross that stops a transfer and the speech bubble"
  was written before the sort sheet, the three filter toggles, the bin on a download, the
  dismiss cross and the upload button existed. There are eight now, and the list says so.
- "Those two controls need a device" undercounted for the same reason: the cross on the
  Downloads tab, the Stop on an item's screen, the Stop beside the upload button and the cross
  that gives up on a failure are four, not two.
- The device checklist had no step for three things built over the last few passes — dismissing
  a failed download, stopping an upload mid-batch, and following a deep link while signed out.
  It has them now. That gap was the worst of the four: the checklist is the handover, and
  features were going in without their checks going in beside them.

Renumbering the checklist went wrong once and is worth recording, because the same mistake has
happened here before. Replacing `^7. **` with `8. **` and working downwards matched the *newly
inserted* step 7 rather than the old one, leaving two 8s and an untouched 7. Renumbering by
position instead of by value is the version that works. A check afterwards confirms all
seventeen steps are sequential and every continuation line is indented to its own step's width —
one was still on three spaces from when it was single-digit.

Two things were checked this pass and found already correct, recorded so they are not chased
again: no `Pressable` that toggles is missing an `accessibilityState`, and React Native's
`Pressable` merges its `disabled` prop into that state itself — `Pressable.js` does
`disabled != null ? {..._accessibilityState, disabled}` — so the upload button was never wrong,
and the explicit `accessibilityState={{ disabled }}` on the login button is redundant rather than
load-bearing.

Verified green: typecheck 4/4, `pnpm -r test` **456**.

### What the unpushed commits contain, checked before anyone pushes them

`main` is 98 commits ahead of `origin/main`, all of them made in this session. None has been
pushed, and none will be from here without being asked: a yes at the start of a session is not
standing authorisation for ninety-eight commits made autonomously over the hours since, and one
of them changes the *web* app's rendering on two presets — a change offered for reversal, which
pushing would make awkward to honour.

What is in them, so the decision does not need this dug up again:

- **95 files, +17,878 / −624.** The bulk is not code: `pnpm-lock.yaml` (+6,371, the Expo
  dependency tree arriving), `docs/PROGRESS.md` (+1,733) and `docs/15-mobile-app.md` (+579).
- **No secrets.** A scan of every added line for credential-shaped values finds one literal,
  `admin-pass-123`, and every occurrence is a fixture in `packages/api/test/*` that boots an
  in-memory server — all pre-existing, none added here.
- **No bloat.** The only binaries are three PNG icons, 2.8–5.5 KB between them.
- **No generated output.** `packages/mobile/ios/`, `packages/mobile/android/` and `dist/` are all
  covered by the root `.gitignore` and none is tracked.
- `.env.example` is a template with no values, and the two `.pem` files are pre-existing TLS
  fixtures for the API tests.

One check misfired and is worth writing down. `git check-ignore packages/mobile/ios` reported the
path as *not* ignored, which read as a real gap — the docs say the generated native projects are
never committed, and a `git add -A` on a Mac after `expo prebuild` would otherwise sweep in an
entire Xcode project. It is ignored. The pattern ends in a slash so it matches directories only,
and the directory does not exist on this machine, so git had nothing to match against. Asking
about a path *inside* it answers correctly. `android/` looked fine in the same command purely
because prebuild had created it here.

Everything on this branch has been verified green at each step: typecheck 4/4, `pnpm -r test`
456, `pnpm -r build` with both Hermes bundles, and `pnpm test:e2e` 20 flows.

### A stub that quietly handed over nothing

`src/lib/progress.ts` began importing `AppState` from `react-native` a few passes ago, to report
a playback position when the app leaves and returns. The test stub for `react-native` provides
only what the library needs, and nobody added it — its docstring still said "Only `Appearance` is
needed".

That did not fail. ESM through Vite hands the importer `undefined` for a name a module does not
export and carries on, so `progress.ts` loaded, `AppState` was nothing, and the whole suite went
on passing. It never bit because the only thing that touches it is a hook and there is no
renderer in this package to call one — so `focus.ts` has been importing the same missing name for
much longer. A test that did drive either would have failed on `undefined.addEventListener`, for
a reason with nothing to do with what it was testing.

The stub has an `AppState` now: it records its listeners, hands back the `{ remove }` shape the
real one does — that shape is what callers store and call, so a stub without it would pass a
subscription and fail a teardown — and can emit a change, which is what a future test of the
reporting wiring will need.

`test/stubs.test.ts` stops it recurring. It reads every named import in `src/lib` from each of
the four stubbed packages, excluding `type` ones since a type is erased before anything runs, and
requires the stub to provide each. A second check requires the name to be something rather than
`undefined`, because present-and-nothing reads to the calling code exactly as absent does — which
is the whole failure. Scoped to `src/lib` on purpose: the components import half of React Native,
and demanding stubs for all of it would be asking for a second React Native.

Control-tested by removing `AppState` again — it names both `focus.ts` and `progress.ts` — and by
leaving it in place as `undefined`, which the second check catches.

Worth being plain that this does not test the wiring. Whether `AppState` actually fires the
progress report still needs a renderer, and remains step 8 of the device checklist. What changed
is that the harness no longer lies about the name existing.

Also read this pass and found correct: `metro.config.js` matches what the docs claim of it, in
particular that `disableHierarchicalLookup` is deliberately not set, and `babel.config.js`,
`tsconfig.json` and `vitest.config.ts` hold nothing surprising.

Verified green: typecheck 4/4, `pnpm -r test` **462** (180 backend + 268 mobile + 12 web +
2 shared).

### The upload path had no tests, and could not have had any

Last pass found the `react-native` stub silently missing `AppState`. Looking for the same shape
elsewhere found a worse one: the filesystem stub had neither `createUploadTask` nor
`FileSystemUploadType`, and `uploads.ts` reaches both through a namespace import — so they were
`undefined` at the call site rather than an error at load. Nothing noticed because no test had
ever called `uploadFile`. It could not: the two things it needs were not there.

That left the whole transfer untested — the multipart options, the bearer header, reading the
name the server actually saved, treating 202 and 422 as answers and anything else as an error,
refusing a body that is not JSON, and the `onTask` handoff the Stop control was built on a few
passes ago. All of it, on the one path that moves a user's own files off their phone.

The guard written last pass would not have caught this. It said, in as many words, that a
namespace import "takes everything, so there is nothing to check name by name" — which is wrong
in the way that matters: an absent member of a namespace object is `undefined` and silent,
exactly like an absent named export. It now resolves the binding from `import * as X` and
requires the stub to provide every `X.member` the library touches. Control-tested by removing
`createUploadTask` again; it names `uploads.ts`.

The stub grew an upload task that records what was sent, can be told what to answer with, and
can be held open so a cancel arrives mid-flight. 8 tests on `uploadFile`, control-tested three
ways: dropping the `onTask` handoff, accepting any status as an answer, and guessing a mime type
the picker did not know.

Also checked this pass and found clean: no `.only`, `.skip` or `.todo` anywhere in the suite; all
twenty test files on disk are executed by the include pattern, and their per-file counts sum to
the reported total. A test that never runs is the same kind of lie as a stub that hands over
nothing, and neither is happening.

What this does not do: the picker, the platform's own upload task, and the Stop button itself
still need a device. What changed is that everything between the button and the server is now
covered.

Verified green: typecheck 4/4, `pnpm -r test` **470** (180 backend + 276 mobile + 12 web +
2 shared), `pnpm -r build`, both Hermes bundles.

### Making the stub check stop being wrong in the same way

Twice now a stub has been silently missing something the app imports, and both times the check
meant to catch it did not, because it only understood the import form that happened to be in
front of me when I wrote it.

- Written for **named** imports. It missed `import * as FileSystem`, and `createUploadTask` was
  absent for the entire life of the upload feature.
- Extended to **namespace** imports. It still missed `import AsyncStorage from …`, so nothing
  checked `getItem` or `setItem` either.

Three rounds, and each time the form left out was the one that was actually wrong. Writing a
third parser this pass and calling it done would have been the same move a third time.

So the default form is covered — and a fourth check now asserts that every `import` or `require`
of a stubbed package matches one of the forms this file knows how to read. `import X, { a } from
'pkg'` matches none of the three parsers, and rather than guess that a fourth parser is the last
one needed, an unrecognised statement fails and says which line it could not read. Control-tested
by introducing exactly that import; it names the line.

The two stubs examined this pass — `expo-secure-store` and `@react-native-async-storage/
async-storage` — turned out to match what the app calls on them. No third defect. The value is
that the check now says so for a reason rather than by luck.

Verified green: typecheck 4/4, `pnpm -r test` **475** (180 backend + 281 mobile + 12 web +
2 shared).

### Chasing the API flake, and being wrong twice about it

Several passes ago `pnpm -r test` failed once in the API package — 114 of 180 — and passed on
every run since. It was recorded rather than chased. This pass chased it.

Two hypotheses, both wrong, both checked rather than acted on:

1. **A fixed sleep before asserting a spawned process is running.** `commands.test.ts` waits a
   flat 150ms after starting a real `node -e …` and then cancels it, which is exactly the shape
   that fails under the CPU contention `pnpm -r` creates by running four suites at once. Dropping
   the wait to 1ms should then have failed it. It passed.
2. **The run not having started when the cancel arrives.** Instrumenting it says the run reports
   `running` at 1ms, 101ms and 201ms alike — the status is set before the process is really up,
   so the cancel has something to act on either way.

Neither is the cause, and the failure has not recurred in roughly fifteen full runs since. The
honest position is that it is unexplained and rare, not fixed. Recorded that way rather than
attributed to the first plausible suspect.

One thing did come out of it. The 150ms was measured to be arbitrary — the state it waits for
arrives in a millisecond — so it was telling nobody anything, and would have been the wrong
number on a slower machine. It now polls for the run to actually report `running`, with a
five-second ceiling, which is what the test is named for. Control-tested by making that state
unreachable: the test fails and says which status it got stuck on instead.

The other two fixed sleeps in the suite (25ms in `gallery.test.ts`, 50ms in `realtime.test.ts`)
are left alone. They pass, nothing has been shown wrong with them, and changing tests that work
on the strength of a hunch is what this pass just spent its time not doing.

Verified: typecheck 4/4, the API suite three times over at 180, and `pnpm -r test` at 475 across
the four packages.

### Seeing it, at last — and why the harness had never worked with real data

The browser extension connected for the first time in seven passes, so the screens changed over
the last dozen or so were finally looked at rather than reasoned about.

The first thing found was that the harness as documented cannot work. `docs/15-mobile-app.md`
gave the export command and nothing else, and a static server on one port pointed at the API on
another is refused by the browser before a single request leaves: the API sets no
`Access-Control-Allow-Origin` and does set `Cross-Origin-Resource-Policy: same-origin`, because
in a real deployment it serves the web app itself. The failure looks exactly like a server that
is up and empty — no data, no error from the server, nothing but failures in the network tab.
Every claim in that section about filters, pagination and empty states being checkable this way
depended on something the section never said.

`packages/mobile/scripts/serve-web.mjs` serves the export and forwards `/api` to a real server,
so the page sees one origin. The doc says to use it and why.

With that, the app ran against the preview server with its fifteen real items: search, folder
chips with counts, the three filter toggles and the sort button, the tab bar, the upload button.
Then the two contrast fixes that had only ever been arithmetic:

- **Error text on a light preset.** Switching branding to `linen` and measuring the rendered Sign
  out button: `rgb(185, 28, 28)` on `rgb(243, 239, 230)`, **5.64:1**. That is `#b91c1c` — the
  value chosen for `DANGER_ON_LIGHT` — and 5.64 is exactly what the unit test predicts. Before
  the fix it was 2.41:1.
- **The current folder's name on the default preset**, which is where that defect actually was.
  On `midnight`: `rgb(159, 139, 248)` at **7.03:1**, and the raw primary measured in the same
  browser against the same background at **3.87:1**. Both match the unit tests to two decimals.

So two changes made from contrast arithmetic are now confirmed against rendered pixels, along
with the defect each replaced. Light mode has also simply been *seen* for the first time.

Two smaller notes. The extension refused several calls with "Cannot access a chrome-extension://
URL of different extension" until the tab was reloaded, so a failure there is worth one reload
before concluding anything. And `read_page` shows the Sign in button with no accessible name,
because react-native-web does not compute a name from children the way a phone does — not a
finding about the app, but a reason not to audit names through this harness.

### The tab bar was the fourth one, and looking is what found it

With the browser working, the one element on every screen turned out to have the same defect
already fixed three times. React Navigation paints an active tab's icon *and* its label with a
single `tabBarActiveTintColor`, and that was the raw primary. Measured in the browser on the
default preset: the word "Browse" at 11px, weight 600, `rgb(110, 76, 255)` on `rgb(22, 22, 29)` —
**3.55:1**. Every inactive label beside it sat at 6.51:1. Normal text holds to 4.5:1.

Fine for the icon, which is a graphical object and holds to 3:1. Not fine for the word under it,
and the tab bar is the one thing visible from every screen in the app.

`tabBarActiveTintColor` is `primaryStrong` now, which is what the two earlier fixes used, and the
browser reports **6.45:1** after the change — still plainly the brand colour beside the muted
labels rather than blending into them.

The point worth recording is how it was found. `test/text-colours.test.ts` was written two passes
ago precisely to catch this class, and it did not, because it only matched `color:` inside a style
object — and this colour never appears as one. Three separate guards have now missed the case
that mattered by understanding only the shape in front of me when I wrote them: the stub check
missed namespace imports, then default imports; this one missed navigator props. It now reads
`tabBarActiveTintColor`, `tabBarInactiveTintColor` and `headerTintColor` as well, control-tested
by putting the raw primary back.

A guard is worth having and is not a substitute for looking at the thing.

Verified green: typecheck 4/4, `pnpm -r test` **475**, and the fix measured on rendered pixels in
the browser it was found in.
