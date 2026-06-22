# 01 — Overview & Specification

> The numbered requirements in this document are the contract. Every other doc elaborates
> *how* to satisfy them. Reference IDs (`FR-…`, `NFR-…`) in code, tests, and PRs.

## 1. Vision

Free-WAN is a personal, self-hosted media server. It unifies video and image content that
is physically spread across several drives into one fast, beautiful, searchable web app,
playable on any device the owner reaches through their Tailscale network. It is private by
default, runs on the owner's own hardware, and is deeply customizable — both in
appearance (branding) and in behavior (user-supplied commands for downloading and
organizing media).

It is *not* a cloud service, *not* multi-tenant SaaS, and stores nothing off the owner's
machines.

## 2. Goals

1. **One library, many drives.** Aggregate content from multiple, independently-mounted
   repositories without moving or copying files.
2. **Plays anything, anywhere.** Direct-play when possible, transcode when necessary, on
   phones, tablets, laptops, and TVs over Tailscale.
3. **Zero-effort organization.** Folder structure *is* the taxonomy; no manual tagging
   required to get a searchable, sortable, browsable library.
4. **Personal and expressive.** The owner controls the name, look, and feel.
5. **Extensible by the owner.** Custom commands turn the UI into a control panel for the
   owner's own automation (downloaders, organizers, re-scans).
6. **Safe to expose over a tailnet.** Authenticated, least-privilege, no surprises.

## 3. Personas

- **Owner / Admin (primary).** Sets up repositories, branding, and commands; has full
  control. Likely the only admin.
- **Viewer (secondary).** A family member or friend invited onto the tailnet. Browses,
  plays, likes, builds collections and clips. May or may not be allowed to run commands.

## 4. Glossary

| Term | Meaning |
|------|---------|
| **Repository** | A configured root directory (typically one per drive/share) that Free-WAN scans for media. |
| **Media item** | A single indexed file: a video or an image. |
| **Category** | A node in the auto-derived taxonomy; corresponds to a folder segment of a media item's path. Hierarchical. |
| **Collection** | A *user-created* grouping of media items (manual, unlike categories). |
| **Clip** | A user-defined in/out range on a source video, played as a loop and optionally exported. |
| **Direct-play** | Serving a file as-is because the browser can decode it. |
| **Transcode** | Converting a file on the fly (to HLS) because the browser cannot decode the original. |
| **Sidecar** | A file next to a media file providing extra data, e.g. `movie.srt` next to `movie.mkv`. |
| **Command** | An admin-registered CLI program with a typed parameter schema, runnable from the UI. |
| **Tailnet** | The owner's private Tailscale network. |

## 5. Functional requirements

### 5.1 Repositories & multi-drive support

- **FR-01** An admin can define multiple repositories, each with a name, a root path, a
  content type hint (`video` | `image` | `mixed`), and an enabled flag.
- **FR-02** Repositories are configured as data — via `config/repositories.yaml` and/or
  the admin UI — and can be added/edited/removed without code changes.
- **FR-03** Each drive is mounted into the container independently; a repository becoming
  unavailable (drive offline) must not crash the app or delete its index — items are
  marked **offline**, not removed.
- **FR-04** Two repositories may live on different physical drives; the unified library
  presents them as one searchable set while remembering each item's source repository.
- **FR-05** Repositories may be mounted read-only; all core features except command
  execution and clip export must work read-only.

### 5.2 Scanning, metadata & auto-categorization

- **FR-06** A scan walks each enabled repository's tree, indexing supported video and
  image files and skipping the rest.
- **FR-07** For each video, extract technical metadata via `ffprobe`: duration, container,
  video/audio codecs, resolution, frame rate, bitrate, audio tracks, embedded subtitle
  tracks, and creation time when present.
- **FR-08** For each image, extract dimensions and, when present, EXIF capture date and
  orientation.
- **FR-09** Generate a poster thumbnail for every item (a representative frame for video;
  a downscaled copy for images) and a hover/scrub preview for video (sprite sheet or short
  preview).
- **FR-10** Derive **categories** from the path: every folder segment between the
  repository root and the file becomes a hierarchical category, and the item is associated
  with the full chain. Example: `Movies/Action/2021/x.mp4` → `Movies` → `Action` → `2021`.
- **FR-11** Categorization updates automatically on rescan when files move; stale
  categories with no items are pruned.
- **FR-12** Scanning is incremental: unchanged files (by path + size + mtime) are not
  reprocessed. A full re-index can be forced.
- **FR-13** The library updates when the filesystem changes — via a filesystem watcher
  and/or a scheduled rescan — without a restart.
- **FR-14** Scan progress and errors are observable in the admin UI (items found, indexed,
  failed) in real time.
- **FR-15** Detect subtitle sidecars (`.srt`, `.vtt`, `.ass`) adjacent to videos and
  associate them as available caption tracks.

### 5.3 Browse, search & sort

- **FR-16** A home/browse view presents the library as a responsive grid of poster
  thumbnails with title and key metadata.
- **FR-17** Full-text search matches title, filename, and category names, returning ranked
  results as the user types (debounced).
- **FR-18** Faceted filtering by: repository, type (video/image), category (one or more,
  hierarchical), liked-by-me, resolution class (e.g. ≥1080p), and duration range.
- **FR-19** Sorting by: title, date added, file/created date, duration, and popularity
  (like count), each ascending/descending.
- **FR-20** Browsing by category presents the taxonomy as navigable folders/breadcrumbs
  mirroring the source structure.
- **FR-21** Every media item has a detail view showing the poster, full metadata, its
  categories, caption availability, like control, and actions (play, add to collection,
  make a clip).
- **FR-22** Search, filter, and sort state is reflected in the URL so views are
  shareable/bookmarkable within the tailnet.

### 5.4 Video playback

- **FR-23** Play video in the browser with a custom-branded player.
- **FR-24** **Direct-play** files the browser supports; **transcode on the fly** to HLS
  (H.264/AAC) for files it does not. The choice is automatic and transparent to the user.
- **FR-25** Adjustable **playback speed** (at least 0.5×–2×, including 1×).
- **FR-26** **Closed captions**: select among embedded subtitle tracks and detected
  sidecars; toggle on/off; captions rendered as WebVTT.
- **FR-27** **Resume**: per-user playback position is saved and offered on return; a
  near-complete item is marked watched.
- **FR-28** Standard transport controls: play/pause, seek (with thumbnail scrub preview
  from FR-09), volume/mute, fullscreen, and keyboard shortcuts.
- **FR-29** Optional hardware-accelerated transcoding when the host exposes a compatible
  GPU; gracefully fall back to software.
- **FR-30** Transcoded output is cached and reused; the cache is bounded and evicted
  by least-recently-used.

### 5.5 Likes & collections

- **FR-31** A user can like/unlike any media item; likes are per-user.
- **FR-32** A "Liked" view lists the current user's likes.
- **FR-33** A user can create named **collections** and add/remove items; collections are
  per-user and orderable.
- **FR-34** Popularity (aggregate like count) is available as a sort key (FR-19) without
  exposing who liked what beyond the owner's own likes.

### 5.6 Images & galleries

- **FR-35** An immersive, full-screen **gallery viewer** displays images and short videos
  from a given context (a category, a collection, or a search result set).
- **FR-36** Navigate **left/right** through the sequence via on-screen tap zones, swipe
  gestures, and arrow keys.
- **FR-37** Short videos in the gallery autoplay muted and loop; tapping unmutes/expands.
- **FR-38** Neighboring items are preloaded for instant transitions; large images are
  served at a display-appropriate size.
- **FR-39** The gallery supports a simple slideshow (auto-advance) with adjustable
  interval, and shows position (e.g. "7 / 240").

### 5.7 Clips & loops

- **FR-40** From any library video, a user can open a **clip builder** and set an in-point
  and out-point (frame-accurate enough for short loops).
- **FR-41** Saving creates a **clip** that plays as a seamless loop of that range.
- **FR-42** A **Clips** section presents saved clips as a grid of autoplaying looping
  previews, filterable/sortable like the main library.
- **FR-43** A clip can optionally be **exported** to a standalone file (MP4, and GIF for
  short ranges) written to a configured output location; export runs as a background job
  with progress.
- **FR-44** Clips reference their source item; deleting a source marks dependent clips as
  orphaned rather than silently breaking them.

### 5.8 Branding & theming

- **FR-45** An admin can set the **site name**, upload a **logo** and **favicon**, and the
  app uses them throughout (header, browser tab, login).
- **FR-46** An admin can choose a **color palette** (at least primary, accent, background,
  surface, text) and a **theme style** from presets, plus light/dark preference.
- **FR-47** An admin can select from a small set of bundled **fonts** (or provide a web
  font) for headings and body.
- **FR-48** Branding applies live across the whole app without a rebuild; it is stored as
  data and survives restarts.

### 5.9 Custom commands & automation

- **FR-49** An admin can register a **command**: a name, description, the executable, and a
  typed **parameter schema** (each parameter has a name, type, optional default, and
  constraints; types include string, number, boolean, enum, and path-within-repository).
- **FR-50** A command defines how parameters map to an **argument vector** (array of
  argv), never a shell string.
- **FR-51** Permitted users **invoke a command through a generated form** — they fill
  fields, they do not type raw command lines.
- **FR-52** On submission, arguments are validated against the schema; invalid input is
  rejected before execution.
- **FR-53** The command runs server-side with **streamed live output** (stdout + stderr)
  shown in the UI, plus the final **exit code** and duration.
- **FR-54** Runs are recorded in a **history** (who, what, when, args, exit code, output)
  and re-viewable; a running command can be **canceled**.
- **FR-55** Commands execute under strict limits: no shell, a timeout, a working-directory
  restriction, an output cap, and least privilege (see [`13-security.md`](13-security.md)).
- **FR-56** Whether a non-admin may run commands (and which) is admin-configurable.
- **FR-57** Commands can trigger internal actions too (e.g. "Rescan repository"), so the
  same UI drives both external tools and built-in maintenance.

### 5.10 Accounts & administration

- **FR-58** Users authenticate with a username and password; sessions are issued on login
  and expire.
- **FR-59** Two roles: **admin** (full control incl. repositories, branding, commands,
  users) and **user** (browse/play/like/collect/clip; commands only if allowed).
- **FR-60** An admin can create, disable, and delete users and reset passwords; the first
  account is bootstrapped from env on first run.
- **FR-61** Per-user data (likes, collections, clips, playback progress, command-run
  history) is isolated by user.
- **FR-62** An admin settings area centralizes repositories, scanning, branding, commands,
  users, and a system/health view (versions, drive status, cache sizes, job queue).

## 6. Non-functional requirements

- **NFR-01 Performance.** Browse grid and search feel instant on a library of ≥100k items:
  search results <300 ms server-side; thumbnails lazy-loaded; lists paginated/virtualized.
- **NFR-02 Playback startup.** Direct-play begins in <2 s on a LAN/tailnet link;
  transcoded playback starts within a few seconds (first HLS segments prioritized).
- **NFR-03 Concurrency.** Support several simultaneous viewers and at least 2 concurrent
  transcodes on typical hardware without UI stalls (jobs queued and bounded).
- **NFR-04 Portability.** One `docker compose up` runs the whole stack on Windows, Linux,
  or a NAS; no per-OS code paths in application logic.
- **NFR-05 Resilience.** A failed scan of one file, or one offline drive, never takes down
  the app; errors are logged and surfaced, not fatal.
- **NFR-06 Security.** All routes except login require authentication; passwords hashed
  with a memory-hard KDF; command execution sandboxed per [`13-security.md`](13-security.md);
  no path traversal outside repositories. See that doc for the full threat model.
- **NFR-07 Privacy.** No external network calls except (a) Tailscale and (b) commands the
  owner explicitly defines. No telemetry.
- **NFR-08 Accessibility.** Keyboard-operable player, gallery, and forms; semantic
  markup; visible focus; captions; respects reduced-motion.
- **NFR-09 Observability.** Structured logs, a health endpoint, and visible job/scan status.
- **NFR-10 Maintainability.** Shared types between client and server; migrations for all
  schema changes; documented config; ADRs for non-obvious decisions.
- **NFR-11 Data durability.** The index, user data, branding, and command history live in
  a single SQLite database under a persistent volume and are safe across restarts and
  upgrades; thumbnails and transcode cache are regenerable and may live separately.
- **NFR-12 Storage discipline.** Generated artifacts (thumbnails, HLS cache, exports) have
  configurable size caps and eviction so they cannot fill a disk unbounded.

## 7. Out of scope (v1)

- Editing/transcoding originals in place (only clip *export* writes new files).
- Live TV / DVR, music-library features, or e-book management.
- Federation between separate Free-WAN instances.
- Mobile native apps (the web app is responsive and installable as a PWA — see frontend doc).
- Cloud backup of the library.

## 8. Acceptance at a glance

The product is "done for v1" when an admin can, from a clean `docker compose up`: connect
two drives, see them scanned and auto-categorized, brand the site, browse/search/sort,
play both a direct-play and a transcoded video with speed + captions + resume, swipe a
photo gallery, build and loop a clip, register and run a `yt-dlp` command from a form and
watch its output, and reach all of it from a phone over Tailscale. Each capability traces
to the `FR`/`NFR` IDs above.
