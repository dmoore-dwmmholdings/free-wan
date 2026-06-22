# 05 — Frontend

React 18 + Vite + TypeScript. React Router for navigation, TanStack Query for all server
data, Zustand for ephemeral UI state, Tailwind for styling, Vidstack for the player. The
app is a PWA (installable, responsive) so it behaves like an app on phones reached over
Tailscale.

## 1. Routes

| Path | Page | Notes |
|------|------|-------|
| `/login` | Login | Branded; reads `GET /api/branding`. Redirects in if already authed. |
| `/` | Browse | Default library grid. Search/filter/sort live in the URL (FR-16/22). |
| `/categories` and `/categories/:id` | Category browser | Folder-style navigation + breadcrumbs (FR-20). |
| `/media/:id` | Detail | Metadata, actions, and the inline player (FR-21). |
| `/watch/:id` | Theater | Full-width player view; deep-linkable; `?t=` start time. |
| `/gallery` | Gallery | Immersive viewer over a context (`?category=`, `?collection=`, or the current search) (FR-35–39). |
| `/liked` | Liked | Current user's likes (FR-32). |
| `/collections` and `/collections/:id` | Collections | List + collection contents (FR-33). |
| `/clips`, `/clips/new`, `/clips/:id` | Clips | Grid of looping clips, builder, and detail (FR-40–44). |
| `/commands` and `/commands/:id` | Commands | Cards + the generated run form & live output (FR-51–54). |
| `/runs/:id` | Run detail | Historical command output (FR-54). |
| `/admin/*` | Admin | `repositories`, `branding`, `commands`, `users`, `system` (FR-58–62). Admin-only guard. |

A route guard redirects unauthenticated users to `/login`; an admin guard protects
`/admin/*`. Guards read `GET /api/auth/me` (cached by TanStack Query).

## 2. App shell & component tree

```
<App>
 ├─ <ThemeProvider>            // injects branding CSS variables (see §5)
 ├─ <AuthGate>                 // ensures session; exposes current user
 │   └─ <AppLayout>
 │        ├─ <TopBar>          // logo, site name, global SearchBox, user menu
 │        ├─ <SideNav>         // Browse, Categories, Liked, Collections, Clips, Commands, Admin
 │        └─ <Outlet/>         // routed page
 └─ <Toaster/> <GlobalPlayerPortal/>
```

Shared building blocks: `MediaGrid` (virtualized), `MediaCard`, `FilterBar`,
`SortMenu`, `CategoryBreadcrumbs`, `LikeButton`, `Pagination/InfiniteScroll`,
`EmptyState`, `ErrorBoundary`, `Spinner`, `ConfirmDialog`.

## 3. Key feature components

- **`<VideoPlayer item>`** — wraps Vidstack. Calls `GET /api/media/:id/playback`, then
  configures source (`mode: direct` → `/stream`; `mode: hls` → `master.m3u8`), caption
  tracks, the speed menu, scrub thumbnails (from `/sprite?meta`), and resume from
  `resumeAt`. Throttled `POST /progress` (~every 10 s and on pause/exit). Keyboard:
  space, ←/→ seek, ↑/↓ volume, `f` fullscreen, `c` captions, `<`/`>` speed.
  Full UX in [`07-feature-video-playback.md`](07-feature-video-playback.md).
- **`<GalleryViewer items index>`** — full-screen pager. Tap-zones left/right, swipe
  (pointer events), arrow keys; preloads neighbors; short videos use a muted-loop
  `<video>`; optional slideshow timer; position indicator. See
  [`09-feature-images-and-clips.md`](09-feature-images-and-clips.md).
- **`<ClipBuilder source>`** — scrubber with in/out handles over the source video,
  live loop preview, save → `POST /api/clips`, optional export.
- **`<ClipCard>`** — autoplaying muted loop preview (IntersectionObserver to play only
  when visible; respects reduced-motion).
- **`<CommandForm command>`** — renders inputs from the command's param schema (string,
  number, boolean→switch, enum→select, repo_path→repository-scoped path picker),
  validates client-side with the shared zod schema, submits to `/run`, and renders
  `<RunConsole>`.
- **`<RunConsole runId>`** — subscribes to `run:{runId}` over WebSocket, appends
  stdout/stderr with stream coloring, shows status/exit code/duration, and a Cancel
  button. Falls back to polling `GET /api/command-runs/:id` if the socket drops.
- **Admin** — `<RepositoryManager>` (with live scan progress via `scan:` topic),
  `<BrandingEditor>` (live preview), `<CommandEditor>` (param builder + `arg_template`),
  `<UserManager>`, `<SystemPanel>`.

## 4. State management

- **Server state → TanStack Query.** One query key per resource/filter set; the Browse
  page key includes the parsed URL params so back/forward and refresh restore exactly
  (FR-22). Infinite queries for grids (cursor pagination). Mutations (like, collection
  edits, progress) optimistically update and invalidate.
- **UI state → Zustand.** Small stores: `playerStore` (current item, speed, captions on),
  `galleryStore` (open, index, context), `uiStore` (sidenav, modals).
- **Realtime → a single `useWebSocket` hook** that manages the `/api/ws` connection and
  fans out subscriptions (scan, job, run); components subscribe to a topic and receive
  typed events.
- **Auth → `useAuth`** backed by `GET /api/auth/me`; logout clears the query cache.

## 5. Design system & theming (drives FR-45–48)

Theming is **runtime**, via CSS custom properties set from `GET /api/branding`. Tailwind
is configured so semantic utilities map to those variables — changing branding restyles
the whole app with no rebuild.

```css
/* injected by <ThemeProvider> into :root from the branding payload */
:root {
  --fw-color-primary:    #4f46e5;
  --fw-color-accent:     #06b6d4;
  --fw-color-bg:         #0b0b10;
  --fw-color-surface:    #16161d;
  --fw-color-text:       #e7e7ea;
  --fw-radius:           0.75rem;
  --fw-font-heading:     "Inter", system-ui, sans-serif;
  --fw-font-body:        "Inter", system-ui, sans-serif;
}
```

```js
// tailwind.config — semantic colors resolve to the variables
theme: { extend: { colors: {
  primary: 'var(--fw-color-primary)',
  accent:  'var(--fw-color-accent)',
  bg:      'var(--fw-color-bg)',
  surface: 'var(--fw-color-surface)',
  ink:     'var(--fw-color-text)',
}, borderRadius: { theme: 'var(--fw-radius)' },
   fontFamily: { heading: 'var(--fw-font-heading)', body: 'var(--fw-font-body)' } } }
```

- **Theme presets** (FR-46) are named bundles of the variables above plus a light/dark
  `mode`; the `<BrandingEditor>` lets an admin pick a preset, then fine-tune colors, with
  a live preview pane. Selected branding persists via `PUT /api/admin/branding`.
- **Logo/favicon/fonts** (FR-45/47) are uploaded to `data/branding/` and referenced by
  URL; the favicon and document title update from the branding payload.
- Respect `prefers-reduced-motion` (disable autoplay loops/slideshow animation) and
  `prefers-color-scheme` as the default before branding loads.

## 6. Performance (NFR-01)

- Virtualized grids (e.g. `@tanstack/react-virtual`); never render 100k DOM nodes.
- Lazy-load posters with `loading="lazy"` and fixed aspect-ratio boxes to avoid layout
  shift; request right-sized images for galleries via `/raw?w=`.
- Debounce search input (~250 ms); cancel in-flight queries on new input.
- Code-split by route; the player and gallery chunks load on demand.
- Prefetch the detail/playback query on card hover/focus.

## 7. Accessibility (NFR-08)

Semantic landmarks, focus-visible styles, full keyboard operation of player, gallery, and
command forms, ARIA labels on icon buttons, captions toggle reachable by keyboard, and
reduced-motion compliance. All interactive controls have a non-hover affordance for touch.

## 8. PWA

Web manifest (name/icons from branding where possible), a service worker that caches the
app shell and static assets (never media bytes), and "Add to Home Screen" support so the
site feels native on phones over the tailnet. The service worker must not cache
authenticated API responses or media.
