# Free-WAN

**Your media. Your hardware. Anywhere.**

Free-WAN is a self-hosted media server for video and image libraries spread across
multiple drives. It runs locally in Docker and is reachable from anywhere over
[Tailscale](https://tailscale.com) — no ports forwarded, no cloud, no subscription.

It gives you a fast, searchable, fully brandable web app for browsing and playing your
content, with adaptive video playback, photo galleries, user-made looping clips,
automatic folder-based categorization, and a safe in-UI runner for your own
download/organize scripts.

---

## What it does

- **Plays video** with adaptive streaming. Browser-native formats direct-play; anything
  else is transcoded on the fly to HLS with `ffmpeg`. Playback-speed control, closed
  captions (embedded + sidecar `.srt`/`.vtt`), and resume-where-you-left-off.
- **Browses & searches** a unified library that spans many drives. Full-text search plus
  faceted filtering and sorting over metadata and categories.
- **Categorizes automatically** from your folder structure. `…/Movies/Action/2021/x.mp4`
  becomes the category path **Movies → Action → 2021**, searchable and sortable with no
  manual tagging.
- **Likes & collections.** Per-user favorites and user-defined collections that live
  alongside the automatic folder categories.
- **Photo & short-video galleries.** Full-screen viewer with tap/swipe/arrow navigation
  left and right; short clips autoplay inline.
- **Clips.** Pick an in/out range on any library video and create an instant looping
  clip. Optionally export it to a standalone MP4/GIF.
- **Your branding.** Site name, logo, favicon, color palette, fonts, and theme style are
  all user-configurable.
- **Custom commands.** Admins register CLI commands (e.g. a `yt-dlp` downloader or a
  re-scan script). Anyone allowed can run them from a generated form — typed arguments,
  no shell typing — and watch live output in the UI. This powers automated
  download/categorization workflows.

## How it's built

A TypeScript stack end to end: **React + Vite** frontend, **Node.js (Fastify)** backend,
**SQLite** storage, **`ffmpeg`/`ffprobe`** for media, packaged as a single **Docker
Compose** app with a Tailscale sidecar. Full rationale in
[`docs/02-architecture.md`](docs/02-architecture.md).

There is also a native **iOS/Android app** (`packages/mobile`, Expo + React Native) that
speaks the same API. It keeps media on the device for offline playback, uploads photos and
video from the phone, shows subtitles, and takes its name and colours from your server's
branding — see [`docs/15-mobile-app.md`](docs/15-mobile-app.md).

---

## Documentation index

Read in order for a full picture; each doc is self-contained and cross-linked.

| # | Document | What's inside |
|---|----------|----------------|
| — | [`AGENTS.md`](AGENTS.md) | **Start here if you are the build agent.** Conventions, repo layout, workflow, definition of done. |
| 01 | [`docs/01-overview-and-spec.md`](docs/01-overview-and-spec.md) | Vision, goals, personas, glossary, and the complete numbered functional & non-functional requirements. |
| 02 | [`docs/02-architecture.md`](docs/02-architecture.md) | Tech stack & rationale, component diagram, runtime processes, data flow, directory layout. |
| 03 | [`docs/03-data-model.md`](docs/03-data-model.md) | Entity model, full SQLite schema (DDL), relationships, indexing, FTS. |
| 04 | [`docs/04-api-reference.md`](docs/04-api-reference.md) | Every REST endpoint and WebSocket channel, with request/response shapes and auth. |
| 05 | [`docs/05-frontend.md`](docs/05-frontend.md) | Routes, pages, component tree, state management, design system, theming hooks. |
| 06 | [`docs/06-media-pipeline.md`](docs/06-media-pipeline.md) | Repository scanning, metadata, thumbnails, transcoding, subtitles, auto-categorization. |
| 07 | [`docs/07-feature-video-playback.md`](docs/07-feature-video-playback.md) | Player UX, speed, captions, resume, direct-play vs. transcode decisioning. |
| 08 | [`docs/08-feature-discovery.md`](docs/08-feature-discovery.md) | Search, filter, sort, likes, and user collections. |
| 09 | [`docs/09-feature-images-and-clips.md`](docs/09-feature-images-and-clips.md) | Photo/short-video gallery and the clips/loops builder. |
| 10 | [`docs/10-feature-branding.md`](docs/10-feature-branding.md) | Branding/theming configuration and asset handling. |
| 11 | [`docs/11-feature-commands.md`](docs/11-feature-commands.md) | Custom command definitions, the run form, live output, and command security. |
| 12 | [`docs/12-deployment.md`](docs/12-deployment.md) | Docker Compose, volumes for multiple drives, Tailscale Serve/Funnel, configuration & env. |
| 13 | [`docs/13-security.md`](docs/13-security.md) | Auth model, threat model, and the command-execution sandbox in depth. |
| 14 | [`docs/14-build-plan.md`](docs/14-build-plan.md) | Phased milestones with acceptance criteria the agent should build to. |
| 15 | [`docs/15-mobile-app.md`](docs/15-mobile-app.md) | The native iOS/Android app: running it, signing in, offline downloads, and building one you keep. |

## Quick start (target end state)

```bash
git clone <your-fork> free-wan && cd free-wan
cp .env.example .env            # set admin creds, JWT secret, Tailscale auth key
# edit config/repositories.yaml to point at your drives
docker compose up -d            # starts app + Tailscale sidecar
# open the printed https://free-wan.<your-tailnet>.ts.net URL from any device
```

> Status: **v1 feature-complete — all 11 build-plan phases (0–10) done.** (scaffold, auth,
> indexing core, discovery, video playback, likes & collections, image gallery, clips & loops,
> branding, custom commands, hardening & Tailscale deploy.) On top of scanning/
> auto-categorization (with a live watcher), full-text search, and browse/filter/sort, the
> app plays **any** video (direct or on-the-fly HLS, with captions/speed/resume behind a
> hardened path resolver), supports per-user **likes** and **collections**, has a full-screen
> **photo gallery**, lets users build looping **clips** (virtual-loop preview + MP4/GIF
> export), and is **owner-brandable** (name/logo/favicon/colors applied live at runtime).
> `pnpm install` then `pnpm dev` (api `:8080`, web `:5173`), or `pnpm -r build && pnpm start`.
> First run creates a bootstrap admin (`ADMIN_USERNAME`/`ADMIN_PASSWORD`, or a generated
> password logged to the console) who must change the password on first login. The
> env-configured credentials stay authoritative across restarts until that first password
> change, so adding `ADMIN_PASSWORD` after an initial boot still takes effect. Admins manage
> media libraries (the folders to index) from the in-app **Repositories** page. Admins can
> register sandboxed **custom commands** (no-shell `spawn`, validated args, cwd jail, env
> allowlist, timeouts, output caps) that permitted users run from generated forms. It ships
> hardened: strict CSP/HSTS headers, a non-root container, a Tailscale Serve sidecar, and an
> admin System panel. It's installable as a **PWA** (branded manifest + icon) and has a
> **Playwright e2e suite** (`pnpm -r build && pnpm test:e2e`) covering login, the forced
> password change, add-library → scan → browse, video playback, clip building, the gallery
> overlay, the branding editor, command creation + a live sandboxed run, and **axe WCAG A/AA
> accessibility audits of every major page (zero violations)** — all in a real browser.
> Remaining refinements are tracked under "post-v1" in
> [`docs/PROGRESS.md`](docs/PROGRESS.md) (read this first if you are the build agent), with
> the roadmap in [`docs/14-build-plan.md`](docs/14-build-plan.md). **456 unit/integration
> tests (180 backend + 262 mobile + 12 web + 2 shared) + 20 e2e flows, all green.**

## License

Choose a license before first release (MIT recommended for a personal/self-hosted tool).
