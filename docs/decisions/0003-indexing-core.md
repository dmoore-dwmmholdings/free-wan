# ADR 0003 — Indexing core (scanning, jobs, categories)

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 2 (Repositories, scanning, metadata, categories)

## Context

Phase 2 builds the indexing pipeline from `docs/06-media-pipeline.md`. A few
implementation choices needed pinning, and the phase is large enough that some of its
acceptance surface (watcher, WebSocket progress) is deliberately carried to the next
iteration.

## Decisions

1. **Injectable prober.** `runScan(db, repoId, prober, opts)` takes a `Prober`
   (`(absPath) => Promise<ProbeResult>`). Production uses `createFfprobe()` (real `ffprobe`
   via `spawn`, argv array, no shell); tests inject a fake. This keeps the whole scanner
   unit-testable **without ffmpeg in CI** (CI has no ffmpeg). `mapProbe(json)` is a separate
   pure function, also unit-tested.

2. **In-process job worker** (`workers/worker.ts`) backed by the `jobs` table. Single
   JS thread → cheap "atomic" claim (select queued → update running). `onIdle()` lets
   callers/tests await a drain. Concurrency default 2. No Redis/BullMQ (per AGENTS.md).
   Scan results (`found/indexed/failed/removed`) are merged back into the job's `payload`
   so `GET /…/scan` can report them (no extra column).

3. **Category counts recomputed, not incremented.** After each scan, `item_count` per
   category is recomputed from `media_categories ⨝ media_items(status='active')`, then
   zero-count nodes are pruned (children cascade via `parent_id`). Simpler and
   self-healing vs. incremental counters; fine at single-instance scale.

4. **Category matching is case-sensitive (path-keyed)** for now. The spec wants
   case-insensitive matching with first-seen display case; that needs a normalized key
   column or `COLLATE NOCASE` on `idx_categories_repo_path`. **Deferred** — noted in
   PROGRESS. Most libraries are case-consistent, so low risk meanwhile.

5. **Repo create validates existence + is-a-directory** (422 otherwise). The fuller
   "allowed roots" allowlist (security §4) is a later hardening; the media/command path
   resolver is where traversal protection will live (Phase 4/9).

6. **Migrations stay hand-authored** (`0002_media.sql` + journal entry), continuing the
   Phase 0/1 pattern. Same `db:generate` caveat as ADR 0002 §6.

## Carried to the next iteration (Phase 2 remainder)

- `chokidar` watcher per enabled/online repo (debounced add/change/unlink → incremental
  probe/remove) and a scheduled full rescan backstop (FR-13).
- WebSocket `scan:{repoId}` progress (FR-14) via `@fastify/websocket` on `/api/ws`
  (the worker already tracks `found/indexed/failed`; wire it to a WS hub).
- Seeding repositories from `config/repositories.yaml` on boot (needs a YAML parser dep).

## Consequences

- Deterministic, ffmpeg-free tests; real ffprobe validated via a live smoke test.
- The job worker generalizes to thumbnails (Phase 3) and transcode/exports (Phase 4/7).
