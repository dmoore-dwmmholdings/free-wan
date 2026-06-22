# 08 — Feature: Discovery (Search, Sort, Likes, Collections)

Implements FR-16–FR-22 and FR-31–FR-34. All discovery is powered by the single
`GET /api/media` endpoint plus `/api/categories`, `/api/collections`, and the like
endpoints (see [`04-api-reference.md`](04-api-reference.md)).

## 1. Browse grid (FR-16)

A responsive, virtualized grid of `MediaCard`s: poster, title, a type/duration badge,
a resolution badge (e.g. "1080p"), a watched/in-progress indicator, and a like toggle.
Cards link to the detail/theater view. Infinite scroll via cursor pagination; the grid
density adapts to viewport (more columns on TV/desktop, fewer on phone).

## 2. Search (FR-17)

A global search box (in the top bar and on Browse) drives `?q=`. Behavior:

- Debounced (~250 ms); in-flight requests are canceled on new input.
- Server uses FTS5 over title, filename, and category names (folder terms match), ranked
  by `bm25` (see [`03-data-model.md`](03-data-model.md) §6). Target <300 ms (NFR-01).
- Empty `q` returns the unfiltered library under the current sort.
- Results combine with active filters (search *within* a category, etc.).

## 3. Filtering (FR-18)

A `FilterBar` exposes facets that map to query params:

- **Repository** (single-select) — drive/source.
- **Type** — video / image.
- **Category** (multi-select, hierarchical) — selecting a parent includes descendants
  because items are linked to every ancestor (data model §2). A category tree/typeahead
  picker is provided.
- **Liked by me** — toggle.
- **Resolution** — class buckets (`≥2160`, `≥1080`, `≥720`, `<720`).
- **Duration** — range slider (e.g. <5 min, 5–30, 30–90, >90, or custom).

Active facets render as removable chips; "Clear all" resets. Facets are additive (AND
across facet types, OR within a multi-select).

## 4. Sorting (FR-19)

A `SortMenu` sets `?sort=` + `?order=`: **Title**, **Date added**, **File/Created date**,
**Duration**, **Popularity** (aggregate like count). Default `added desc`. The chosen sort
applies to search results and category views alike.

## 5. URL as state (FR-22)

Every discovery view serializes `q`, `type`, `repository`, `category[]`, `liked`,
`minHeight`, `minDuration`/`maxDuration`, `sort`, `order`, and scroll cursor into the URL.
Back/forward and refresh restore the exact view; links are shareable within the tailnet.
The TanStack Query key derives from these params so caching and prefetch line up.

## 6. Category browsing (FR-20)

`/categories` presents the taxonomy as folders. Navigating a node shows its child
categories (from `parent_id`) and the items whose leaf is that node, with breadcrumbs back
to the repository root. This mirrors the on-disk structure exactly, giving a familiar
"file browser" path alongside search.

## 7. Detail view (FR-21)

`/media/:id` shows the poster/inline player, full metadata (duration, resolution, codecs,
size, dates), the **category chain** as breadcrumb links, **caption availability**,
the **like** control with count, and actions: **Play / Resume**, **Add to collection**,
**Make a clip** (opens the clip builder seeded with this source), and (admin) **Reveal in
repository** (shows `repository + rel_path`, never an absolute host path).

## 8. Likes (FR-31, FR-32, FR-34)

- `LikeButton` toggles via `PUT`/`DELETE /api/media/:id/like` with optimistic UI; the
  response returns the new `likeCount`.
- `/liked` is Browse pre-filtered to `liked=true` for the current user.
- Likes are per-user (FR-61). Aggregate counts feed the **Popularity** sort (FR-34)
  without exposing *who* liked an item beyond the viewer's own state.

## 9. Collections (FR-33)

- `/collections` lists the current user's collections (name, cover, count). Create with a
  name (+ optional description).
- `/collections/:id` shows contents as a grid; items can be added from any detail view or
  card overflow menu, removed, and **reordered** (drag handles → `PATCH …/items { order }`).
- A collection can set a **cover** item. Collections are private to their owner in v1.
- A collection's contents can be opened in the **gallery** viewer (FR-35) or played as a
  queue.

## 10. Acceptance

Typing a folder term surfaces matching items; filtering by a parent category includes
nested items; switching sort reorders instantly; the URL round-trips the full view;
liking updates count and the Liked view; a user can build, reorder, and reopen a
collection. Traces to FR-16–FR-22, FR-31–FR-34.
