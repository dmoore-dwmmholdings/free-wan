# ADR 0006 — Video playback (direct-play core)

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 4 (Video playback — direct-play path; HLS carried over)

## Decisions

1. **Hardened path resolver** (`lib/path-safety.ts`, `resolveWithinRoot`) is the single
   gate for opening media bytes (security §4): `realpath` + prefix check rejects `..`
   traversal, symlink escape, absolute-path injection, and missing files (→ 404). Used by
   `/stream` and `/captions`.

2. **Ranged `GET /api/media/:id/stream`** streams the original file with `Accept-Ranges`,
   206 partial (`Content-Range`/`Content-Length`), 416 on unsatisfiable ranges, and a
   content-type from the extension. `createReadStream(abs, {start,end})` — no whole-file
   buffering.

3. **`GET /api/media/:id/playback`** returns `{mode, url, captions[], resumeAt, duration}`
   using the **cached `playback_mode`** from Phase 2 (no re-probing). `direct` →
   `/stream`; `hls` → `/hls/master.m3u8` (endpoint pending — see carry-over).

4. **Captions converted to WebVTT on demand** via an injectable `CaptionConverter`
   (`services/captions.ts`, real ffmpeg / fake in tests). Sidecar `.vtt` is served verbatim;
   `.srt`/`.ass`/embedded are converted (`ffmpeg -f webvtt`). Route:
   `/api/media/:id/captions/:trackId.vtt`.

5. **Resume/watched** in a new `playback_progress` table (migration `0004_playback`,
   per-user PK). `POST /progress` upserts; `watched` flips at ≥92% and is **sticky**;
   `playback` returns `resumeAt` only when not watched and > 5 s. Per-user isolation tested.

6. **Player: native HTML5 `<video>` for now** (`components/VideoPlayer.tsx`), not yet
   Vidstack. It fully covers direct-play: resume seek, `<track>` WebVTT captions, speed
   menu, and throttled progress posting (10 s + on pause/end/unmount). It is **isolated in
   one component** so swapping in the mandated Vidstack player (for scrub-preview thumbnails
   + richer controls) is a drop-in, not a refactor. `/watch/:id` theater route + Play button.

## Verification

- api **55/55** tests (+8 playback: path-safety traversal, direct descriptor, full stream,
  206 range, sidecar VTT, resume/watched, per-user isolation, auth).
- Live built-server smoke with **real ffmpeg mp4**: descriptor `mode:direct`; ranged stream
  `206` `Content-Range: bytes 0-99/30374`; progress save → `resumeAt 12.5`.

## Carried over (Phase 4 remainder — do before Phase 5)

- **On-the-fly HLS transcode** (the big one): `transcode` job + `GET /hls/master.m3u8` +
  `/hls/:variant/:segment` from `data/hls/<id>/`; prioritized first segments; **single-flight
  per (item,variant)**; LRU cache + idle-process kill; optional HW accel (nvenc/qsv/vaapi)
  with software fallback. ffmpeg recipe in `docs/06-media-pipeline.md` §8.
- **Scrub sprite sheets** (`/sprite?meta`) — deferred from Phase 3; needed for timeline previews.
- **Swap native player → Vidstack** (`@vidstack/react`) for the full controls/keyboard set
  in `docs/07-feature-video-playback.md` §2/§6.
