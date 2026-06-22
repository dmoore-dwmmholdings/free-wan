# ADR 0005 — Discovery (search, media API, thumbnails)

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 3 (Discovery & thumbnails)

## Decisions

1. **Standalone FTS5 table with `media_item_id UNINDEXED`** (`media_fts`, migration
   `0003_fts`) rather than external-content/rowid mapping. The scanner upserts a row per
   item (`title`, `filename`, folder-derived `categories`) in `services/fts.ts`. Search is a
   **filter, not a sort**: `searchFtsIds(q)` returns matching ids, then the normal
   filter/sort/paginate query applies (`id IN (...)`). User input is converted to quoted
   prefix terms so FTS5 metacharacters are inert. Orphaned FTS rows (after repo delete) are
   harmless — the join to `media_items(status='active')` drops them. *(Relevance/bm25 sort
   can be added as `sort=relevance` later.)*

2. **`GET /api/media` is one composable endpoint** (`routes/media.ts`): filters `type`,
   `repository`, `category` (nested via `media_categories`, so a parent includes
   descendants), `minHeight`, `minDuration/maxDuration`, plus `q`. Sorts `title/added/
   created/duration` (`popularity` falls back to recency until likes land in Phase 5). Each
   card carries its **leaf** `categoryPath` (left-join on `is_leaf=1`) and a `posterUrl`.
   `liked/likeCount` are stubbed (false/0) until Phase 5.

3. **Pagination = opaque offset cursor** (base64 `{o}`). Satisfies the `{data, nextCursor,
   total}` contract and is simple/correct for v1. Keyset pagination (stable under concurrent
   inserts) is a documented refinement.

4. **Thumbnails via an injectable `Thumbnailer`** (`services/thumbnailer.ts`, real ffmpeg /
   fake in tests), mirroring the prober pattern. The scanner's `onIndexed` enqueues a
   `thumbnail` job per item; the handler writes `data/thumbs/<id>/poster.jpg` (video: frame
   ~10% in; image: downscaled) and stores `poster_path` **relative to the data dir**.
   `GET /api/media/:id/poster` streams it with a 1-day cache header. Sprite sheets (scrub
   previews) and `/raw?w=` gallery variants are **deferred to Phase 4/6** where they're used.

## Verification

- api **47/47** tests (+8 discovery: list, FTS via title & folder name, type/nested-category
  filters, title sort, cursor pagination, detail chain, poster serving, category tree, authz).
- Live built-server smoke with **real ffmpeg**: scan → `GET /api/media` cards, `q=hero`
  search, detail (`h264`/direct), and a real **480×270 JPEG poster** served (HTTP 200).

## Deferred (non-blocking)

- Sprite sheets + `/raw?w=` resized variants (Phase 4/6); virtualized grid; dedicated
  category-browser page; keyset pagination; relevance sort; large-library perf load-test
  (NFR-01, Phase 10). Liked filter + popularity sort (Phase 5).
