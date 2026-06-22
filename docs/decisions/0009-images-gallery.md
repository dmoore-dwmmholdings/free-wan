# ADR 0009 — Images gallery

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 6 (Images gallery)

## Decisions

1. **`GET /api/media/:id/raw` (images only)** — original bytes, or a width-resized JPEG via
   `?w=` (clamped 64–3840). Variants are generated on first request through an injectable
   `ImageVariantMaker` (`services/images.ts`, real ffmpeg `scale=W:-2` / fake in tests),
   cached at `data/thumbs/<id>/w<W>.jpg` and served `immutable`. On any resize failure it
   falls back to the original. Path access goes through the same `resolveWithinRoot` gate as
   `/stream`. This is the `/raw?w=` work that was deferred from Phase 3.

2. **`<GalleryViewer>` (web)** — a self-contained full-screen overlay driven by the caller's
   current `MediaCard[]` + a start index (so it launches from whatever Browse is filtered to:
   category / collection / search / all). One unified pointer handler distinguishes **tap
   zones** (left=prev, center=toggle chrome, right=next) from **swipe** (horizontal =
   navigate, down = close) via a `moved` flag, avoiding tap/swipe double-fire; keyboard
   ←/→/Esc/space; ±1 neighbor image preload; slideshow (5 s, space toggles); a `current /
   total` indicator; short videos autoplay muted+loop (suppressed under
   `prefers-reduced-motion`). Sized requests use `viewport × devicePixelRatio`.

3. **Launch from Browse** — image cards open the gallery at their index over the loaded
   result set; video cards still navigate to detail/watch. (`CardInner` is shared; the
   wrapper is a `<button>` for images, a `<Link>` for videos.)

## Verification

- api **73/73** tests (+4 gallery: original bytes, width variant + immutable cache,
  video-rejection 404, auth).
- Live built-server smoke with **real ffmpeg**: `/raw` → 1000×800 original (43.7 kB);
  `/raw?w=320` → a real **320×256** JPEG (10.8 kB), `image/jpeg`, `immutable`.

## Deferred (non-blocking)

- Windowing for 10k-photo sequences beyond the loaded page (paging the gallery past the
  current result window); pinch-zoom + original-on-zoom; the `<GalleryViewer>` overlay was
  not driven in a real browser this session (builds + typechecks) — a manual pass is worth
  doing alongside the player's.
