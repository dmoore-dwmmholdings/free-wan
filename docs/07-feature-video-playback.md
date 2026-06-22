# 07 — Feature: Video Playback

Implements FR-23–FR-30. Built on Vidstack (`@vidstack/react`). The server makes the
direct-vs-transcode decision (see [`06-media-pipeline.md`](06-media-pipeline.md) §7–8);
this doc specifies the player-side UX and contract.

## 1. Playback handshake

1. On opening `/watch/:id` (or the inline player on `/media/:id`), call
   `GET /api/media/:id/playback`, sending lightweight client capability hints in the query
   (e.g. `?h265=1&av1=0` derived from `MediaSource.isTypeSupported`).
2. Response:
   ```json
   {
     "mode": "direct",
     "url": "/api/media/ID/stream",
     "captions": [{ "id": "t1", "label": "English", "language": "en",
                    "url": "/api/media/ID/captions/t1.vtt", "default": true }],
     "resumeAt": 132.5,
     "duration": 1820.0,
     "spriteMetaUrl": "/api/media/ID/sprite?meta"
   }
   ```
   For `mode: "hls"`, `url` is the `master.m3u8`. Vidstack plays HLS via its bundled
   hls.js provider; direct sources play natively with byte-range requests.
3. Configure the player source, attach caption tracks, load scrub sprites, and seek to
   `resumeAt` if offered (see §4).

## 2. Controls & speed (FR-25, FR-28)

Standard transport: play/pause, timeline with buffered ranges and **scrub-preview
thumbnails** from the sprite sheet, current/total time, volume + mute, fullscreen, and
picture-in-picture where supported.

**Playback speed**: a menu with at least `0.5, 0.75, 1, 1.25, 1.5, 1.75, 2`×, default 1×.
Speed persists across items within a session (`playerStore`) and applies equally to direct
and HLS playback (audio pitch preserved by the browser). Keyboard `<`/`>` step speed.

## 3. Captions (FR-26)

- The captions menu lists every track from the playback response (embedded + sidecars),
  plus **Off**. Tracks are WebVTT served by the captions endpoint (converted on demand).
- A `default` track may be pre-selected (e.g. matching the UI language); otherwise Off.
- Selection persists per session; toggling is keyboard-accessible (`c`).
- Caption styling honors the theme and `prefers-reduced-transparency`/legibility settings;
  font size is adjustable in the captions menu.
- If a track fails to load, surface a non-blocking notice and fall back to Off.

## 4. Resume & watched (FR-27)

- **Save**: `POST /api/media/:id/progress { positionS, durationS }` throttled to ~every
  10 s during playback and once on pause, seek-settle, and unmount/visibility-hidden.
- **Restore**: if `resumeAt > 15 s` and the item isn't watched, show a "Resume from mm:ss
  / Start over" affordance; auto-resume can be a user preference.
- **Watched**: when `positionS >= 0.92 * durationS`, mark `watched=1` and clear the resume
  prompt; watched items show a badge in grids and can be filtered.
- Progress is per-user (FR-61); two users have independent positions on the same file.

## 5. Direct vs. transcode UX (FR-24, FR-29)

- The mode is invisible to the user; both paths present identical controls.
- On a transcode start, show a brief "Preparing…" state until the first segments are ready
  (server prioritizes them; NFR-02). If HW transcode fails, the server silently falls back
  to software (the client just keeps playing).
- If direct-play stalls because the device actually can't decode a codec the matrix
  thought was fine, the client reports the failure and the server re-issues a `hls` source
  for retry (graceful downgrade).

## 6. Keyboard shortcuts

`space`/`k` play-pause · `←`/`→` seek ∓10 s · `j`/`l` seek ∓10 s · `↑`/`↓` volume ·
`m` mute · `f` fullscreen · `c` captions · `<`/`>` speed · `0–9` seek to 0–90% ·
`Esc` exit fullscreen/theater. All discoverable via a `?` help overlay.

## 7. Errors & edge cases

- Offline source (drive unplugged) → friendly "This item is temporarily unavailable"
  (item `status=offline`), not a raw player error.
- Missing audio/odd track counts → default to the first audio track; expose a track menu
  if more than one.
- Very large seeks on a transcode → request a new transcode at the seek offset (`-ss`),
  reusing cache when the segment already exists.
- Network drop on HLS → hls.js recovers; on fatal error, re-fetch the playback descriptor
  once before surfacing an error.

## 8. Acceptance

A browser-friendly MP4 plays via `/stream` with working speed, captions (sidecar `.srt`),
scrub thumbnails, and resume; a non-friendly file (e.g. MKV/HEVC) plays via on-the-fly
HLS with the same controls; closing and reopening resumes at the saved position; a second
user has an independent position. Traces to FR-23–FR-30.
