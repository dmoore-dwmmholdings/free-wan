# 04 — API Reference

All application data flows through a JSON REST API under `/api`, with binary media on
streaming endpoints and realtime events over a WebSocket. The built React app is served
from `/`. URLs are **relative** so the app works unchanged behind Tailscale Serve.

## 1. Conventions

- **Base path:** `/api`. **Content type:** `application/json` unless streaming bytes.
- **Auth:** a signed, httpOnly session cookie (`fw_session`) set on login. Every endpoint
  requires a valid session **except** `POST /api/auth/login`, `GET /api/branding`, and
  `GET /api/health`. Admin-only endpoints live under `/api/admin` and require
  `role = admin`.
- **Validation:** request bodies and query params are validated with zod (shared schemas).
  Invalid input → `422`.
- **IDs:** opaque strings (UUIDv7). Media is always addressed by `id`, never by path.
- **Pagination:** list endpoints accept `?limit=` (default 50, max 200) and `?cursor=`
  (opaque). Responses return `{ data: [...], nextCursor: string | null, total?: number }`.
- **Errors:** uniform shape
  ```json
  { "error": { "code": "string", "message": "human readable", "details": { } } }
  ```
  Codes: `unauthorized` (401), `forbidden` (403), `not_found` (404),
  `validation_error` (422), `conflict` (409), `rate_limited` (429), `internal` (500).
- **Time:** epoch-millis integers. **Booleans:** JSON `true/false` (DB stores 0/1).

## 2. Auth & session

| Method | Path | Body / Query | Returns |
|--------|------|--------------|---------|
| POST | `/api/auth/login` | `{ username, password }` | `200` sets `fw_session` cookie, `{ user }`; `401` on bad creds. Rate-limited. |
| POST | `/api/auth/logout` | — | `204`; revokes the session. |
| GET | `/api/auth/me` | — | `{ user: { id, username, role, canRunCommands } }`. |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` | `204`. |

## 3. Users (admin)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/admin/users` | — | list of users (no hashes). |
| POST | `/api/admin/users` | `{ username, password, role, canRunCommands? }` | `201` user. |
| PATCH | `/api/admin/users/:id` | `{ role?, disabled?, canRunCommands? }` | updated user. |
| POST | `/api/admin/users/:id/password` | `{ newPassword }` | `204` (admin reset). |
| DELETE | `/api/admin/users/:id` | — | `204`. Cannot delete the last admin. |

## 4. Repositories & scanning (admin)

| Method | Path | Body / Query | Returns |
|--------|------|--------------|---------|
| GET | `/api/admin/repositories` | — | repositories with `status`, `lastScanAt`, counts. |
| POST | `/api/admin/repositories` | `{ name, rootPath, type, readOnly? }` | `201`; validates path exists & is allowed. |
| PATCH | `/api/admin/repositories/:id` | `{ name?, enabled?, type?, readOnly? }` | updated. |
| DELETE | `/api/admin/repositories/:id` | `?purge=true` | `204`; removes index (keeps files). |
| POST | `/api/admin/repositories/:id/scan` | `{ full?: boolean }` | `202 { jobId }`; subscribe via WS. |
| GET | `/api/admin/repositories/:id/scan` | — | latest scan job `{ status, progress, found, indexed, failed }`. |

## 5. Library: browse, search, filter, sort

### `GET /api/media`
The single endpoint backing browse, search, category views, liked view, and gallery
sequences. All params optional and composable.

| Query param | Type | Meaning |
|-------------|------|---------|
| `q` | string | Full-text query (FR-17). |
| `type` | `video\|image` | Restrict to a media type. |
| `repository` | id | Restrict to one repository. |
| `category` | id (repeatable) | Items in this category *or any descendant* (FR-18, nested). |
| `liked` | `true` | Only items liked by the current user. |
| `collection` | id | Items in a collection (ordered by position). |
| `minHeight` | int | Resolution class filter, e.g. `1080`. |
| `minDuration`,`maxDuration` | seconds | Duration range. |
| `sort` | enum | `title\|added\|created\|duration\|popularity` (default `added`). |
| `order` | `asc\|desc` | Default `desc`. |
| `limit`,`cursor` | — | Pagination. |

**Returns** `{ data: MediaCard[], nextCursor, total }` where `MediaCard` =
```json
{
  "id": "…", "type": "video", "title": "…",
  "durationS": 412.3, "width": 1920, "height": 1080,
  "posterUrl": "/api/media/ID/poster",
  "repositoryId": "…", "categoryPath": "Movies/Action/2021",
  "liked": true, "likeCount": 3,
  "progress": { "positionS": 120.0, "watched": false }
}
```

### `GET /api/media/:id`
Full detail (FR-21): all metadata, `categories[]` (id+name+path chain), `subtitles[]`
(id, kind, language, label), `playback` summary, `liked`, `likeCount`, `progress`,
and `actions` availability.

## 6. Media streaming & playback

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/media/:id/playback` | Returns `{ mode: "direct"\|"hls", url, captions:[{id,label,language,url}], resumeAt }` (FR-24/26/27). |
| GET | `/api/media/:id/stream` | Direct-play. Honors HTTP `Range`; responds `206` with `Accept-Ranges: bytes`. Correct `Content-Type`. |
| GET | `/api/media/:id/hls/master.m3u8` | Master playlist; triggers/locates the transcode job (FR-24/29/30). |
| GET | `/api/media/:id/hls/:variant/:segment` | HLS media segments from `data/hls/` cache. |
| GET | `/api/media/:id/captions/:trackId.vtt` | Caption track converted to WebVTT (FR-26). |
| GET | `/api/media/:id/poster` | Poster image (FR-09); cacheable, `ETag`. |
| GET | `/api/media/:id/sprite` | Scrub sprite sheet + `?meta` returns sprite geometry JSON (FR-28). |
| GET | `/api/media/:id/raw` | Original image bytes (images); supports `?w=` for a resized variant (FR-38). |
| POST | `/api/media/:id/progress` | `{ positionS, durationS }` throttled save (FR-27); `204`. |

Streaming endpoints set long-lived cache headers for immutable derived assets and
`no-store` for playlists. All require a valid session; the cookie rides along on
`<video>`/`<img>` requests because URLs are same-origin.

## 7. Categories

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/categories` | `?repository=&parent=` → child category nodes `{ id, name, path, depth, itemCount, hasChildren }` for tree/breadcrumb navigation (FR-20). |
| GET | `/api/categories/:id` | One node + its ancestor chain (breadcrumbs). |

## 8. Likes & collections

| Method | Path | Body | Returns |
|--------|------|------|---------|
| PUT | `/api/media/:id/like` | — | `200 { liked: true, likeCount }` (FR-31). |
| DELETE | `/api/media/:id/like` | — | `200 { liked: false, likeCount }`. |
| GET | `/api/collections` | — | current user's collections w/ counts + cover. |
| POST | `/api/collections` | `{ name, description? }` | `201`. |
| PATCH | `/api/collections/:id` | `{ name?, description?, coverItemId? }` | updated. |
| DELETE | `/api/collections/:id` | — | `204`. |
| POST | `/api/collections/:id/items` | `{ mediaItemId, position? }` | `204` (FR-33). |
| PATCH | `/api/collections/:id/items` | `{ order: [mediaItemId…] }` | reorder. |
| DELETE | `/api/collections/:id/items/:mediaItemId` | — | `204`. |

## 9. Clips

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/clips` | `?sort=&cursor=` | user's clips as cards (autoloop preview URL) (FR-42). |
| POST | `/api/clips` | `{ sourceItemId, name, startS, endS, loop? }` | `201` clip (FR-40/41). |
| GET | `/api/clips/:id` | — | clip detail incl. source reference, `orphaned` flag (FR-44). |
| PATCH | `/api/clips/:id` | `{ name?, startS?, endS?, loop? }` | updated. |
| DELETE | `/api/clips/:id` | — | `204`. |
| GET | `/api/clips/:id/preview` | — | looping preview stream (virtual loop over source range). |
| POST | `/api/clips/:id/export` | `{ format: "mp4"\|"gif" }` | `202 { jobId }`; writes to `data/exports/` (FR-43). |
| GET | `/api/clips/:id/export` | — | export status + download URL when ready. |

## 10. Branding

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/branding` | — | **public** (used by login screen): `{ siteName, logoUrl, faviconUrl, theme, mode, colors, fonts }` (FR-45–48). |
| PUT | `/api/admin/branding` | branding JSON | validated + persisted to `settings`. |
| POST | `/api/admin/branding/asset` | multipart `logo\|favicon\|font` | stores under `data/branding/`, returns URL. |

## 11. Commands & runs

| Method | Path | Body | Returns | Role |
|--------|------|------|---------|------|
| GET | `/api/commands` | — | commands the caller may run (form schema incl. params) (FR-51). | user (if allowed) |
| POST | `/api/commands/:id/run` | `{ args: { paramName: value } }` | `202 { runId }`; validates args, then enqueues (FR-52/53). | per-command |
| GET | `/api/command-runs` | `?commandId=&mine=` | run history (FR-54). | self / admin all |
| GET | `/api/command-runs/:id` | — | run detail + output (capped) + `resolvedArgv` (audit). | owner/admin |
| POST | `/api/command-runs/:id/cancel` | — | `202`; signals the worker to kill (FR-54). | owner/admin |
| GET | `/api/admin/commands` | — | all command definitions. | admin |
| POST | `/api/admin/commands` | command + params (see data model §5) | `201`. | admin |
| PATCH | `/api/admin/commands/:id` | partial | updated. | admin |
| DELETE | `/api/admin/commands/:id` | — | `204`. | admin |

Argument validation, the no-shell guarantee, and execution limits are specified in
[`11-feature-commands.md`](11-feature-commands.md) and enforced per
[`13-security.md`](13-security.md).

## 12. System (admin) & health

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/health` | `{ status: "ok", version }` — unauthenticated liveness. |
| GET | `/api/admin/system` | versions (app, ffmpeg), repository/drive status, cache sizes (thumbs/hls/exports), queue depth (FR-62). |
| GET | `/api/admin/jobs` | `?status=` recent jobs with progress/errors. |
| POST | `/api/admin/cache/transcode/clear` | clears HLS cache (NFR-12). |

## 13. WebSocket — `/api/ws`

One authenticated socket per client (cookie-authenticated on upgrade). The client sends
`{"type":"subscribe","topic":"…"}`; the server pushes events. Topics:

- `scan:{repositoryId}` → `{ type:"scan", repositoryId, status, progress, found, indexed, failed }` (FR-14).
- `job:{jobId}` → `{ type:"job", jobId, jobType, status, progress, error? }`.
- `run:{runId}` → command output streaming (FR-53):
  - `{ type:"run.output", runId, stream:"stdout"|"stderr", chunk }`
  - `{ type:"run.status", runId, status, exitCode?, durationMs? }`

Events are also retrievable via REST (polling fallback) so the UI degrades gracefully if
the socket drops.

## 14. Caching & range semantics (summary)

- Derived immutable assets (`/poster`, `/sprite`, HLS segments): `Cache-Control:
  public, max-age=31536000, immutable` + `ETag`.
- `/stream` and `/raw`: support `Range`, return `206`/`200`, never cached as immutable.
- Playlists (`*.m3u8`) and all JSON: `no-store`.
- The web app shell is fingerprinted by Vite and cached aggressively; `index.html` is
  `no-store`.
