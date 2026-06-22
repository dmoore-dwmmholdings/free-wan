# 14 — Build Plan

A phased roadmap the build agent follows in order. Each phase is independently
demoable and ends with acceptance criteria and tests tied to requirement IDs. Don't start
a phase until the previous one's acceptance passes. Track decisions as ADRs under
`docs/decisions/`.

> Legend: **Goal** → what exists at the end · **Build** → key work · **Covers** → FR/NFR
> IDs · **Done when** → acceptance · **Tests** → minimum coverage.

## Phase 0 — Scaffold

- **Goal:** a running, empty full-stack skeleton in Docker.
- **Build:** monorepo (npm/pnpm workspaces) with `packages/{shared,api,web}`; Fastify
  serving the built Vite app; zod-shared types; Drizzle + SQLite wired with a no-op
  migration; structured logging; `Dockerfile` + `docker-compose.yml`; lint/format/test
  config (Vitest); CI that builds and tests.
- **Covers:** NFR-04, NFR-10.
- **Done when:** `docker compose up` serves a "hello" page and `GET /api/health` returns ok.
- **Tests:** health route; build passes in CI.

## Phase 1 — Auth & users

- **Goal:** login works; roles enforced; bootstrap admin.
- **Build:** `users`/`sessions` tables + migration; Argon2id hashing; login/logout/me;
  httpOnly session cookie; auth + admin middleware (deny by default); rate-limited login;
  first-run admin bootstrap from env with forced password change; admin user CRUD; login UI
  + route guards + branded login shell.
- **Covers:** FR-58–61, NFR-06.
- **Done when:** an admin logs in, creates a user, that user logs in and is blocked from
  `/api/admin/*`; sessions expire and revoke.
- **Tests:** auth happy/again-failure paths; authz matrix (anon/user/admin × public/user/
  admin routes); password hashing/verify; rate-limit.

## Phase 2 — Repositories, scanning, metadata, categories (indexing core)

- **Goal:** point at drives → a populated, auto-categorized index.
- **Build:** `repositories`, `media_items`, `categories`, `media_categories`,
  `subtitle_tracks` schema; repository CRUD (+ seed from `repositories.yaml`); the job
  queue + worker; `scan`/`probe` jobs (incremental walk, `ffprobe` via spawn, upsert);
  folder→category derivation; sidecar subtitle detection; offline/missing handling;
  chokidar watcher + scheduled rescan; scan progress over WebSocket.
- **Covers:** FR-01–15, FR-57 (rescan internal), NFR-05.
- **Done when:** scanning two mounted folders indexes videos+images, derives the correct
  category chains, detects an `.srt`, leaves the app healthy when a drive is unplugged
  (items → offline), and reflects a newly added file without restart.
- **Tests:** category derivation (nested, separators, depth cap); incremental skip by
  signature; offline vs missing; ffprobe JSON mapping against fixture media; prune empty
  categories.

## Phase 3 — Discovery & thumbnails

- **Goal:** a fast, searchable, sortable browse experience.
- **Build:** `thumbnail` job (poster, sprite, image variants); `GET /api/media` with
  search (FTS5), facets, sort, cursor pagination; categories tree endpoints; detail
  endpoint; web Browse grid (virtualized), FilterBar, SortMenu, search box, category
  browser, detail view; URL-as-state.
- **Covers:** FR-16–22, NFR-01.
- **Done when:** a folder term finds items via FTS; filtering by a parent category includes
  nested items; sorts reorder; the URL round-trips; posters lazy-load; performance targets
  hold on a seeded large library.
- **Tests:** search ranking/scoping; nested-category filter SQL; pagination cursors; sort
  correctness; thumbnail generation against fixtures.

## Phase 4 — Video playback

- **Goal:** play anything, with speed, captions, resume.
- **Build:** playback decisioning (capability matrix) + `playback` endpoint; ranged
  `/stream`; on-the-fly **HLS transcode** job with prioritized first segments, single-flight
  per (item,variant), LRU cache + idle kill; optional HW accel with software fallback;
  caption conversion to WebVTT; `playback_progress` save/restore + watched; Vidstack-based
  `<VideoPlayer>` with speed menu, captions menu, scrub thumbnails, keyboard shortcuts,
  theater route.
- **Covers:** FR-23–30, NFR-02/03.
- **Done when:** a browser-friendly MP4 direct-plays and a non-friendly MKV/HEVC plays via
  HLS — both with speed, sidecar+embedded captions, scrub previews, and per-user resume;
  transcode cache evicts under cap.
- **Tests:** decision matrix cases; range responses (206/partial); WebVTT conversion;
  progress throttle + watched threshold; single-flight transcode; cache eviction.

## Phase 5 — Likes & collections

- **Goal:** per-user favorites and manual groupings.
- **Build:** `likes` + endpoints with optimistic UI and counts; Liked view; `collections`/
  `collection_items` CRUD, add/remove/reorder, cover; popularity sort wired.
- **Covers:** FR-31–34, FR-61.
- **Done when:** liking updates count and the Liked view; collections are created,
  reordered, reopened; popularity sort reflects aggregate likes; users are isolated.
- **Tests:** like toggle idempotency; per-user isolation; reorder persistence; popularity
  sort.

## Phase 6 — Images gallery

- **Goal:** immersive left/right photo + short-video browsing.
- **Build:** `<GalleryViewer>` (tap zones, swipe, arrow keys), neighbor preloading +
  windowing, sized image variants (`/raw?w=`), muted-loop short videos, slideshow with
  interval, position indicator, reduced-motion handling; launch from category/collection/
  search.
- **Covers:** FR-35–39, NFR-08.
- **Done when:** a photo-heavy context opens full-screen at the tapped item, navigates
  instantly via swipe/keys, autoloops interspersed short clips, and runs a slideshow.
- **Tests:** sequence windowing/paging; preloading; keyboard + gesture nav; reduced-motion
  fallback.

## Phase 7 — Clips & loops

- **Goal:** build looping clips, optionally export.
- **Build:** `clips` schema; `<ClipBuilder>` (in/out scrubber, live loop preview), create/
  edit; `/clips` grid with autolooping `ClipCard`s; virtual-loop preview endpoint;
  `clip_export` job (MP4/GIF) with progress; orphan handling on source deletion.
- **Covers:** FR-40–44.
- **Done when:** a user sets an in/out range, previews the loop, saves it, sees it
  autolooping in `/clips`, exports a downloadable MP4/GIF with progress, and a deleted
  source marks the clip orphaned (not broken).
- **Tests:** range validation (`end>start`, max len); virtual-loop playback; export job
  output via ffprobe; orphan transition.

## Phase 8 — Branding

- **Goal:** owner-driven name/logo/colors/fonts, applied live.
- **Build:** `settings['branding']` + zod; public `GET /api/branding`; asset upload
  (validated, SVG-sanitized); `<BrandingEditor>` with presets + live preview; runtime CSS
  variables via `<ThemeProvider>`; favicon/title/PWA manifest from branding.
- **Covers:** FR-45–48.
- **Done when:** changing name/logo/palette/font restyles the whole app (incl. login + tab)
  immediately and after restart, no rebuild.
- **Tests:** branding schema validation; asset type/size/SVG-sanitization; theme variable
  application; persistence across restart.

## Phase 9 — Custom commands & automation

- **Goal:** admins register CLI commands; permitted users run them from forms with live
  output — safely.
- **Build:** `commands`/`command_params`/`command_runs` schema; `<CommandEditor>` (param
  builder + `arg_template`); `<CommandForm>` (typed fields incl. repo-scoped path picker);
  argv builder with the **no-shell** guarantee; the sandboxed runner (allowlist, validated
  args, cwd jail, env allowlist, timeout, output cap, concurrency cap, non-root); live
  output over WebSocket + `<RunConsole>`; cancel; run history; internal commands (rescan,
  rebuild thumbnails, clear cache) wired through the same UI.
- **Covers:** FR-49–57, FR-55, NFR-06; full [`13-security.md`](13-security.md) §5.
- **Done when:** an admin registers a `yt-dlp` command; a permitted user runs it from a
  form, watches streamed output, cancels/sees exit code, and finds it in history with the
  resolved argv; a rescan internal command then surfaces the download auto-categorized;
  injection and path-escape attempts are rejected.
- **Tests:** argv construction (literals, prefixes/suffixes, booleans, enums); injection
  attempts inert (metacharacters as data); `repo_path` escape rejected; timeout kills;
  output cap truncates; env not inherited; authz for non-admin run; cancel kills process
  group.

## Phase 10 — Hardening, deploy, polish

- **Goal:** production-ready self-host.
- **Build:** Tailscale Serve config (+ documented Funnel opt-in); GPU compose variant;
  security headers/CSP/HSTS; backup/restore docs + SQLite online backup; cache size caps +
  admin System panel (versions, drive status, cache sizes, queue); PWA service worker
  (shell only, never media/authed responses); accessibility pass; load/perf check on a
  large seeded library; end-to-end Playwright flows.
- **Covers:** NFR-01–12; the §9 security checklist in [`13-security.md`](13-security.md).
- **Done when:** the v1 acceptance walkthrough ([`01-overview-and-spec.md`](01-overview-and-spec.md)
  §8) passes end-to-end from a clean `docker compose up`, reachable on a phone over
  Tailscale, with the security checklist green.
- **Tests:** Playwright: login → browse/search → play (direct + transcode) → gallery swipe
  → build/loop a clip → run a command; security checklist automated where feasible.

## Cross-cutting (every phase)

- Validate at the API boundary with zod; return the standard error shape.
- New columns/tables via Drizzle migrations only.
- No subprocess via a shell; no path escapes a repository root.
- Tag commits/PRs/tests with the `FR`/`NFR` IDs they satisfy; keep
  [`03-data-model.md`](03-data-model.md) and [`04-api-reference.md`](04-api-reference.md)
  in sync with reality.

## Suggested milestones

- **M1 (Phases 0–3):** browseable, searchable, auto-categorized library across drives.
- **M2 (Phases 4–6):** full playback + likes/collections + photo galleries.
- **M3 (Phases 7–8):** clips + branding — the "make it mine" milestone.
- **M4 (Phases 9–10):** automation commands + hardened Tailscale deployment = v1.
