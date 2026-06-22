# 09 — Feature: Images Gallery & Clips

Two related features: an immersive photo/short-video gallery (FR-35–39) and a clip/loop
builder (FR-40–44).

## Part A — Gallery viewer (FR-35–39)

### A1. Entry & context

The gallery opens over a **context** — an ordered sequence of media items — from any of:
a category view, a collection, the current search/browse result set, or "view all photos".
It is launched with the sequence's query (so it can page beyond the loaded window) and a
start index. Route: `/gallery?…context…&i=<index>`.

### A2. Navigation (FR-36)

Full-screen, distraction-free. The user moves **left/right** through the sequence via:

- **Tap zones**: left third = previous, right third = next, center = toggle chrome.
- **Swipe**: horizontal pointer/touch gestures with momentum; vertical swipe-down closes.
- **Keyboard**: `←`/`→` prev/next, `Esc` close, `space` play/pause slideshow, `f`
  fullscreen.

A position indicator shows `current / total` (FR-39). Chrome (close, indicator, like,
info) auto-hides during interaction.

### A3. Images & short videos (FR-37)

- **Images** render at a display-appropriate resolution via `/api/media/:id/raw?w=` sized
  to the viewport/devicePixelRatio (FR-38); the original is fetched only on explicit
  zoom/download.
- **Short videos** inline **autoplay muted and loop**; tapping the center unmutes and
  shows full controls (promotes to the full player for longer items). Respect
  `prefers-reduced-motion`: no autoplay, show a poster with a play affordance.

### A4. Performance (FR-38)

Preload the **neighbors** (±1, optionally ±2) so left/right feels instant; decode images
off the main path where possible; release off-screen media to cap memory. The sequence is
windowed — only a handful of items are mounted at once even for a 10k-photo folder.

### A5. Slideshow (FR-39)

A slideshow mode auto-advances on a configurable interval (e.g. 3/5/10 s); short videos
play to the end (or one loop) before advancing. Pause/resume by tap or `space`.

### A6. Acceptance

From a photo-heavy category, the gallery opens full-screen at the tapped item; swiping and
arrow keys move smoothly with instant neighbors; an interspersed short clip autoplays
muted and loops; slideshow advances and the counter tracks position. Traces FR-35–39.

## Part B — Clips & loops (FR-40–44)

### B1. Clip builder (FR-40, FR-41)

Opened from a video's detail view ("Make a clip") or `/clips/new?source=<itemId>`:

- A scrubber over the source video with draggable **in** and **out** handles, numeric
  time fields, and frame-step buttons for precision; a live **loop preview** plays the
  selected range repeatedly using ranged playback of the source (no render needed).
- Constraints: `out > in`; an optional max clip length (config) keeps loops short;
  show the resulting duration.
- Save → `POST /api/clips { sourceItemId, name, startS, endS, loop }` creates a clip and a
  poster (a frame at the in-point).

### B2. Clips section (FR-42)

`/clips` is a grid of `ClipCard`s, each an **autoplaying muted loop** of its range
(played via `/api/clips/:id/preview`, which loops the source between in/out). Cards play
only while visible (IntersectionObserver) and honor reduced-motion (show poster + hover to
play). Clips are filterable/sortable like the main library (by name, date, source
category) and are per-user.

### B3. Virtual loop vs. export (FR-43)

- **Virtual loop (default, instant):** the clip is metadata only; playback loops the
  source between `startS` and `endS`. No disk cost, available immediately, works on
  read-only repositories.
- **Export (optional):** `POST /api/clips/:id/export { format }` runs a background
  `clip_export` job (ffmpeg cut to **MP4**, or **GIF** for short ranges — commands in
  [`06-media-pipeline.md`](06-media-pipeline.md) §10), writing to `data/exports/` and
  offering a download when ready. Progress streams over `job:{id}`.

### B4. Source lifecycle (FR-44)

A clip references its source item. If the source is deleted or goes `missing`, the clip is
flagged **orphaned** (its `source_item_id` set null) rather than silently breaking; the UI
shows it as unavailable and offers to delete it. An exported clip remains playable from its
exported file even if the source is gone.

### B5. Acceptance

A user selects an in/out range on a library video, previews the loop, and saves it; it
appears in `/clips` autolooping; exporting produces a downloadable MP4/GIF with progress;
deleting the source marks the clip orphaned, not broken. Traces FR-40–44.
