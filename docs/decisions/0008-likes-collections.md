# ADR 0008 — Likes & collections

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 5 (Likes & collections)

## Decisions

1. **Schema** (migration `0005_social`): `likes(user_id, media_item_id, created_at)` PK on
   the pair + index on `media_item_id`; `collections(id, user_id, name, description,
   cover_item_id→media_items SET NULL, …)`; `collection_items(collection_id, media_item_id,
   position, added_at)` PK on the pair. All per-user.

2. **Likes** (`routes/likes.ts`): `PUT /api/media/:id/like` (idempotent via
   `onConflictDoNothing`) / `DELETE` return `{liked, likeCount}`. Aggregate count is a
   `COUNT(*)`; the caller's own `liked` is a separate per-user lookup.

3. **`GET /api/media` now computes real like data** via correlated subqueries
   (`likeCount`, and a per-user `liked`), replacing the Phase-3 stubs. New filters:
   `liked=true` (EXISTS for the caller) and `collection=<id>` (membership + ordered by
   `collection_items.position`). `sort=popularity` orders by the aggregate like-count
   subquery (no longer a recency fallback). Per-page subqueries are fine at single-instance
   scale; revisit with a denormalized counter if a library ever gets huge.

4. **Collections** (`routes/collections.ts`): owner-scoped CRUD; `owned()` gates every
   mutation/read by `user_id` so one user can't touch another's (FR-61) — returns 404, not
   403, to avoid leaking existence. Add appends at `max(position)+1`; reorder rewrites
   positions from the `order` array; cover is any item id. `itemCount`/`coverUrl` derived
   for the DTO.

5. **Web:** `LikeButton` (heart + count, stops propagation so it works atop a card link),
   wired into Browse cards + Detail; header nav (Library / **Liked** = `?liked=true` /
   **Collections**); a "Most liked" sort; `CollectionsPage` (list/create/delete, open a
   collection as `/?collection=<id>` in Browse). TanStack Query invalidation keeps counts fresh.

## Verification

- api **69/69** tests (+7 social: like idempotency, **per-user isolation with aggregate
  counts**, `liked` filter, **popularity sort**, unlike, collections CRUD + **reorder**,
  collection per-user isolation, auth).
- Live built-server smoke: like → `{liked:true,likeCount:1}`; `?liked=true` → 1 item;
  popularity sort reflects likes; add-to-collection `204`; `?collection=` → 1; `GET
  /api/collections` shows the collection with `itemCount:1`.

## Deferred (non-blocking)

- Collection drag-reorder UI (API + `PATCH …/items` reorder exist and are tested); opening a
  collection in the gallery/queue (Phase 6); collection cover-picker UI.
