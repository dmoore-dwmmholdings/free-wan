# ADR 0007 — On-the-fly HLS transcode (completes Phase 4)

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 4 (Video playback — HLS)

## Decisions

1. **`TranscodeManager`** (`services/transcode.ts`) with an injectable `TranscodeStarter`
   (real ffmpeg / fake in tests). `ensure(id, absPath)` is **single-flight**: a request for a
   transcode already running returns the same output dir without spawning a second ffmpeg, and
   a completed transcode (`#EXT-X-ENDLIST` present on disk) is reused from cache. A periodic
   sweep kills transcodes idle past `idleMs` (disabled under tests). `data/hls/<id>/` holds
   `index.m3u8` + `seg_*.ts`.

2. **Routes** (`routes/playback.ts`): `GET /hls/master.m3u8` ensures the transcode and returns
   a master pointing at the relative `index.m3u8` (single growing rendition for v1).
   `GET /hls/:file` validates `:file` against `^(index\.m3u8|seg_\d+\.ts)$` (no traversal),
   briefly waits for a just-started `index.m3u8`, and streams playlist (`no-store`) /
   segments (`immutable`). ffmpeg recipe = `docs/06-media-pipeline.md` §8 (libx264 veryfast,
   aac, `-hls_time 4`, mpegts segments).

3. **Player plays HLS via `hls.js`** (web dep) with native-HLS fallback (Safari); direct-play
   still streams natively. Still isolated in `VideoPlayer` for the eventual Vidstack swap.

4. **Bug fix — container decision by file extension.** A live smoke revealed that ffprobe
   reports an `.mkv` container as `matroska,webm`; the old `decidePlaybackMode` matched `webm`
   in the allow-list and wrongly chose **direct** for MKVs (which browsers can't reliably play
   inline). Fixed: `decidePlaybackMode` now keys the container check on the **file extension**
   (`ext ∈ {mp4,m4v,webm,mov}`), not the ambiguous `format_name`. `.mkv`/`.avi` → `hls`.

## Verification

- api **62/62** tests (+6 HLS: descriptor routing, master serving + transcode start, playlist
  + segment serving, bogus-segment-name 400, single-flight cache reuse, auth; + the corrected
  decision unit tests).
- Live built-server smoke with **real ffmpeg**: an `.mkv` (h264/aac) now reports `mode:hls`
  and transcodes to a complete HLS playlist (`#EXT-X-ENDLIST`) with a 79.9 kB `.ts` segment
  served at `video/mp2t`. A browser-friendly `.mp4` still direct-plays with 206 ranges.

## Deferred (polish, non-blocking)

- Multi-bitrate ladder + `-ss` seek-offset transcodes; LRU **size** cap eviction (idle-kill
  is in); HW accel (nvenc/qsv/vaapi) wiring. Scrub sprite sheets. Swap player → Vidstack.
