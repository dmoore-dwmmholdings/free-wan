# AGENTS.md — Build guide for Free-WAN

This file orients the agent (or developer) implementing Free-WAN. Read it fully before
writing code, then follow [`docs/14-build-plan.md`](docs/14-build-plan.md) phase by phase.

## Mission

Implement the media server specified in `docs/`. The specification is the source of
truth. Where a doc is silent, prefer the simplest solution consistent with the
architecture in [`docs/02-architecture.md`](docs/02-architecture.md) and record the
decision in `docs/decisions/` (one short ADR per choice).

## Decisions already made (do not relitigate)

These were chosen by the project owner; build to them.

| Area | Decision |
|------|----------|
| Language | **TypeScript** across frontend and backend. |
| Frontend | **React 18 + Vite**, React Router, TanStack Query (server state), Zustand (UI state), Tailwind CSS (themed via CSS variables). |
| Player | **Vidstack** (`@vidstack/react`). Video.js is the only sanctioned fallback if a hard blocker appears. |
| Backend | **Node.js 20+ with Fastify**, TypeScript, served as one process that also serves the built frontend. |
| Database | **SQLite** via **Drizzle ORM** on **better-sqlite3**. FTS5 for search. No external DB server. |
| Media | Invoke **`ffmpeg`/`ffprobe` directly** via `child_process.spawn` with explicit argument arrays. **Do not use `fluent-ffmpeg`** — it was archived/deprecated in May 2025 and breaks on current ffmpeg. |
| Jobs | In-process worker (Node `worker_threads` or a single async queue) backed by a `jobs` table in SQLite. No Redis/BullMQ. |
| Accounts | **Multi-user** with roles `admin` and `user`. Per-user likes, collections, clips, and progress. |
| Packaging | **Docker Compose**, cross-platform, with a **Tailscale** sidecar. ffmpeg bundled in the image. |
| Transcoding | **Hybrid**: direct-play when the browser can play the file, else on-the-fly HLS transcode. Optional HW accel. |

If you believe one of these is wrong, raise it as an ADR proposal rather than silently
deviating.

## Repository layout (target)

```
free-wan/
├── README.md
├── AGENTS.md
├── docs/                      # the specification (this set)
│   └── decisions/             # ADRs you add as you build
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── config/
│   ├── repositories.yaml      # user-defined drives/libraries
│   └── free-wan.example.yaml  # app config template
├── packages/
│   ├── shared/                # types & zod schemas shared by api+web
│   ├── api/                   # Fastify backend
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── db/            # drizzle schema, migrations, client
│   │   │   ├── routes/        # one module per resource (see API doc)
│   │   │   ├── services/      # scanner, transcoder, thumbnailer, commands…
│   │   │   ├── workers/       # job queue + handlers
│   │   │   └── lib/           # auth, config, logging, ffmpeg helpers
│   │   └── test/
│   └── web/                   # React app
│       ├── src/
│       │   ├── routes/        # page components
│       │   ├── components/
│       │   ├── features/      # feature-scoped hooks/components
│       │   ├── lib/           # api client, theme, player setup
│       │   └── main.tsx
│       └── test/
└── data/                      # created at runtime (db, thumbs, hls cache, uploads)
```

Use a workspace tool (npm workspaces or pnpm) so `shared` types are imported by both
`api` and `web`. Pin all dependency versions; record the lockfile.

## Conventions

- **Types first.** Define request/response and entity types in `packages/shared` with
  `zod` schemas; derive TypeScript types from them and validate at every API boundary.
- **No shell strings for subprocesses.** Always `spawn(cmd, argsArray)`. Never build a
  command string and pass it to a shell. This rule is load-bearing for security
  (see [`docs/13-security.md`](docs/13-security.md)).
- **Path safety.** Treat every filesystem path derived from user input as hostile.
  Resolve and confirm it stays inside an allowed repository root before touching it.
- **Stable IDs.** Requirements are referenced as `FR-xx`/`NFR-xx` in
  [`docs/01-overview-and-spec.md`](docs/01-overview-and-spec.md). Tag commits/PRs and
  tests with the IDs they satisfy.
- **Migrations, not hand-edits.** All schema changes go through Drizzle migrations.
- **Config over code.** Repositories, branding, and commands are data (DB or YAML), never
  hardcoded.
- **Accessibility & keyboard.** The player, gallery, and command forms must be fully
  keyboard-operable.

## Workflow

1. Work one phase of [`docs/14-build-plan.md`](docs/14-build-plan.md) at a time.
2. For each feature, satisfy the requirement IDs it lists, write tests against them, and
   only then move on.
3. Keep a running `docs/decisions/` log of any choice not dictated by the spec.
4. Update [`docs/04-api-reference.md`](docs/04-api-reference.md) and
   [`docs/03-data-model.md`](docs/03-data-model.md) if reality diverges from the spec —
   the docs must stay true.

## Definition of done (per feature)

- All referenced `FR`/`NFR` IDs met.
- Input validated with zod at the boundary; errors return the standard error shape.
- Unit/integration tests cover the happy path and the main failure paths.
- No subprocess invoked via a shell string; no path escapes a repository root.
- Works behind Tailscale Serve over HTTPS (relative URLs, no hardcoded hostnames).

## Testing

- **Backend:** Vitest + Fastify `inject` for routes; a temp SQLite file per test run;
  a tiny set of fixture media files (a 2-second H.264 MP4, a non-browser-friendly AVI/MKV,
  a JPEG, an `.srt`) committed under `packages/api/test/fixtures`.
- **Frontend:** Vitest + React Testing Library; Playwright for the critical flows
  (login, browse, play, gallery swipe, run a command).
- **Media:** assert on `ffprobe` JSON output, not on pixels.

## What not to do

- Don't add a cloud dependency, telemetry, or external auth provider.
- Don't introduce Redis, Postgres, or a second runtime language.
- Don't expose raw filesystem paths to the client; reference media by `mediaItem.id`.
- Don't let command execution touch a shell, exceed its timeout, or run as root.
