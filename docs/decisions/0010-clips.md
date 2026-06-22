# ADR 0010 — Clips & loops

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 7 (Clips & loops)

## Decisions

1. **`clips` table** (migration `0006_clips`): a clip is metadata over a source range —
   `source_item_id` (FK **SET NULL** so a deleted source orphans rather than removes the
   clip, FR-44), `start_s`/`end_s` (DB `CHECK end_s>start_s`), `loop`, `export_status`
   (`none|queued|rendering|ready|failed`), `export_path`. Per-user.

2. **Clip CRUD** (`routes/clips.ts`, owner-scoped): create/list/read/patch/delete with range
   validation (`end>start`, `≤ MAX_CLIP_SECONDS=600`, re-validated on patch). `owned()`
   gates everything by `user_id` (404 on others'). Source must be a video.

3. **Virtual-loop preview (default, instant — FR-43).** `GET /api/clips/:id/preview` returns
   a descriptor `{sourceUrl: /stream, startS, endS, loop, orphaned}`; the client loops the
   source between in/out via `timeupdate` — **no render, works on read-only repos**. The
   web `ClipCard`/`ClipBuilder` implement the loop client-side.

4. **Export = background `clip_export` job** via an injectable `ClipExporter`
   (`services/clip-export.ts`, real ffmpeg / fake in tests). `POST /export` sets `queued` +
   enqueues; the handler renders to `data/exports/<id>.<fmt>` (MP4 = libx264+faststart; GIF =
   palettegen/paletteuse), flips `ready` + `export_path`, and publishes `job:{id}` events.
   `GET /export` reports status + download URL; `GET /download` streams the file
   (`Content-Disposition: attachment`). Orphaned clips reject new exports (409) but a
   previously-exported file still downloads (FR-44).

5. **Web:** `ClipBuilder` (`/clips/new?source=`) — source video with Set-in/Set-out capture,
   a live loop preview, and save; `/clips` grid of `ClipCard`s that **virtual-loop while
   visible** (IntersectionObserver) with export/download/delete; "✂ Make a clip" on video
   detail; Clips nav link.

## Verification

- api **81/81** tests (+8 clips: create + range validation, list/read/patch, preview, export
  job + download, per-user isolation, orphan-on-source-delete keeping the export, auth).
- Live built-server smoke with **real ffmpeg**: create clip [1.0–2.5] → preview descriptor →
  export → a real MP4 of duration **1.533s** (matching the range) downloaded as `video/mp4`.

## Deferred (non-blocking)

- Frame-step precision + clip poster at the in-point (currently uses the source poster);
  GIF export not live-smoked (command implemented + mp4 verified); browser pass of the
  builder/grid (builds + typechecks).
