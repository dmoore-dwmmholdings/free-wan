# ADR 0004 — Realtime events & filesystem watcher

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 2 (completion: FR-13 watcher, FR-14 scan progress)

## Decisions

1. **In-process `EventHub` pub/sub** (`services/events.ts`) fans realtime events to
   WebSocket subscribers. Topics follow API doc §13 (`scan:{repoId}`, later `job:`/`run:`).
   The scanner emits an `onProgress(snapshot)` callback; the scan job handler publishes it
   to `scan:{repoId}`. No external broker.

2. **WebSocket via `@fastify/websocket`** at `/api/ws` (`routes/ws.ts`). Cookie-authenticated
   on upgrade using the **same** `resolveSession()` as HTTP (now exported from the auth
   plugin); unauthenticated upgrades are closed with code 1008. Clients send
   `{type:'subscribe',topic}`; only `scan:`/`job:`/`run:` prefixes are accepted. Per-socket
   subscriptions are cleaned up on close/error. Tested with `app.injectWS` (auth-reject +
   subscribe-and-forward).

3. **Watcher = repo-level debounced rescan, not per-file probing** (`services/watcher.ts`,
   `chokidar`). Any add/change/unlink under a repo root schedules (debounced,
   `WATCH_DEBOUNCE_MS`, default 1500) a single incremental `scan` job. Because the scanner
   already skips unchanged files by signature, a full incremental scan is cheap and far
   simpler/safer than maintaining per-event probe/remove paths. Watchers are (re)synced from
   the DB on boot and after every repo create/patch/delete. **Disabled under `env==='test'`**
   so test apps don't leak file handles; the debounce logic is unit-tested directly via the
   public `schedule()` with fake timers.

4. **Scheduled full-rescan backstop** — a `setInterval` (`RESCAN_INTERVAL_MIN`, default 360;
   0 disables) enqueues a low-priority scan for every enabled repo. Catches missed watcher
   events and recovers `offline → online`. Disabled under tests; cleared on app close.

## Verification

- api **39/39** tests (incl. EventHub, watcher debounce, scan-progress publish, WS auth +
  forward). Live built-server smoke: created a repo, scanned (`itemCount 1`), then **added a
  new file → watcher auto-rescanned → `itemCount 2` with no restart** (FR-13).

## Consequences

- Realtime plumbing (hub + WS) generalizes to job/run streaming in Phases 3/9.
- Watcher cost is one cheap incremental scan per quiet period, not per file event.
- Still deferred (minor, non-blocking): YAML repo seeding on boot; case-insensitive
  category matching (ADR 0003 §4).
