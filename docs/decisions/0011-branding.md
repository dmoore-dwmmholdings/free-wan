# ADR 0011 — Branding & theming

- **Status:** accepted
- **Date:** 2026-06-21
- **Phase:** 8 (Branding)

## Decisions

1. **`settings` key/value table** (migration `0007_settings`, data model §4) stores branding
   as JSON under key `branding`, validated by a zod schema (`getBranding`/`setBranding` in
   `services/branding.ts`; falls back to `DEFAULT_BRANDING` on missing/corrupt).

2. **Public `GET /api/branding`** (`routes/branding.ts`, no auth) so the **login screen** is
   branded. `PUT /api/admin/branding` (admin) accepts the editable subset (asset URLs are
   server-managed) and **deep-merges** `colors`/`fonts` into the current value, so the editor
   can send just what changed. `updateBrandingRequestSchema` makes `colors`/`fonts`
   deep-partial.

3. **Asset upload** `POST /api/admin/branding/asset?kind=logo|favicon` (`@fastify/multipart`,
   2 MB cap): validates mimetype against an allowlist (svg/png/jpg/webp/ico), **sanitizes
   SVGs** (`lib/sanitize-svg.ts` strips `<script>`/`<foreignObject>`/`on*` handlers/
   `javascript:` URLs) before writing to `data/branding/<kind>.<ext>`, and records the URL on
   the branding object. `GET /api/branding/asset/:kind` serves it. (SVG sanitizer is
   best-effort — pair with CSP; serve same-origin only.)

4. **Runtime theming via CSS variables (FR-48, no rebuild).** Web `ThemeProvider` fetches
   branding and writes `--brand-color`/`--brand-accent` (the Tailwind theme already resolves
   `brand` → `var(--brand-color)`), sets `document.title`, and swaps the favicon. `BrandingPage`
   (admin, `/settings/branding`) = site name + presets (midnight/slate/neon/paper) + color
   pickers + mode + logo/favicon upload + Save/Reset, with **live preview** (writes
   `--brand-color` on draft change) and persistence on Save (query cache updated → app
   restyles). Header logo/name + login card read branding.

## Verification

- api **87/87** tests (+6 branding: SVG sanitizer, public default GET, admin deep-merge PUT,
  invalid-color 422, admin-only authz, persistence across restart).
- Live built-server smoke: public default GET; PUT site name + primary reflected; **SVG logo
  uploaded and served sanitized** (no `<script>`/`onload`, `<rect>` kept); bad type → 422;
  `logoUrl` set.

## Deferred (non-blocking)

- Light/dark mode + background/surface/text are stored and editable but only `--brand-color`
  is wired into components (most use hardcoded `neutral-*`); a full semantic-token pass would
  make background/surface/text live too. Font upload (woff2) accepted by the model but not
  applied. PWA manifest from branding. Browser pass of the editor.
