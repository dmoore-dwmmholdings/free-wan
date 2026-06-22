# ADR 0013 — Hardening & deployment (Phase 10)

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 10 (Hardening, deploy, polish) — the final phase to v1

## Decisions

1. **Security headers via `@fastify/helmet`** (security §7): a strict **CSP**
   (`default-src 'self'`; `script-src 'self'` — no inline scripts; `style-src 'self'
   'unsafe-inline'` for React/Tailwind style attrs; `img/media 'self' data: blob:`;
   `connect-src 'self' ws: wss:` for the WebSocket; `object-src 'none'`; `frame-ancestors
   'none'`; `base-uri 'self'`), **HSTS** (1y, includeSubDomains), `X-Content-Type-Options`,
   `Referrer-Policy`, `X-Frame-Options`. `trustProxy` (config `TRUST_PROXY`) is on behind the
   Tailscale Serve TLS proxy.

2. **Admin System panel** (`routes/admin/system.ts`): `GET /api/admin/system`
   (app/node/ffmpeg versions, uptime, per-repository status + counts, cache sizes for
   thumbs/hls/exports, queue depth), `GET /api/admin/jobs?status=` (recent jobs), and
   `POST /api/admin/cache/transcode/clear` (wipes the regenerable HLS cache, NFR-12). Web
   `/settings/system` page polls it. ffmpeg version is best-effort (null if absent).

3. **Non-root container** (security §5/§9): the runtime image runs as `USER node`; the data
   dir is chowned to it. **Tailscale Serve** sidecar is wired in `docker-compose.yml` (the
   app shares the sidecar's net namespace; `config/tailscale/serve.json` proxies
   `${TS_CERT_DOMAIN}:443 → 127.0.0.1:8080`); Funnel is an opt-in edit. A
   `docker-compose.gpu.yml` override adds the NVIDIA device reservation for NVENC.

4. **Backup/restore** (NFR-11): all durable state is one SQLite file (`data/free-wan.db`)
   plus uploaded `data/branding/`. Stop the app (or use SQLite online backup) and copy
   `data/`; regenerable caches (`thumbs/`, `hls/`, `exports/`) can be excluded and rebuilt.

## Verification

- api **104/104** tests (+4 system: CSP/HSTS/nosniff/frame-ancestors headers present, system
  info shape, jobs + cache-clear, admin-only authz).
- Live built server (`NODE_ENV=production`): full CSP + HSTS + nosniff + Referrer-Policy on
  both `/api/*` and the static SPA (which still renders under CSP); `/api/admin/system`
  returns real ffmpeg version + queue + cache sizes; cache-clear `200`.

## Security checklist (security §9) — status

- ✅ Non-public routes reject unauthenticated requests (authz tests across phases).
- ✅ Argon2id; httpOnly/SameSite/Secure revocable sessions; login rate-limited.
- ✅ Path resolver blocks `..`/symlink/absolute escapes (media, captions, repo_path) — tested.
- ✅ Commands: `shell:false`, allowlisted exe, validated argv, env allowlist, cwd jail,
  timeout, output cap, non-root — tested with real spawn.
- ✅ `repo_path` cannot escape its repository — tested.
- ✅ `.env` git-ignored; secrets not logged (auth bodies not logged; command env allowlisted).
- ✅ CSP + security headers present; Funnel disabled unless explicitly enabled.
- ✅ Per-user isolation for likes/collections/clips/runs/progress — tested.

## Deferred (polish — not blocking v1 functionality)

- PWA service worker (shell-only) + manifest-from-branding; full accessibility pass;
  Playwright e2e for the critical flows; per-command concurrency cap; transcode cache **size**
  cap eviction (idle-kill exists); the browser passes for player/gallery/branding/command
  editor; the admin CommandEditor UI.
