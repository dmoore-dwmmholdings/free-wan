# 10 — Feature: Branding & Theming

Implements FR-45–FR-48. Branding is data (a `branding` JSON in `settings`, plus uploaded
assets under `data/branding/`) applied at **runtime** via CSS variables — no rebuild.
Frontend mechanics live in [`05-frontend.md`](05-frontend.md) §5; this doc defines the
configurable surface and the admin flow.

## 1. What an admin can brand

| Aspect | FR | Detail |
|--------|----|--------|
| **Site name** | FR-45 | Shown in the top bar, login screen, document `<title>`, and PWA manifest name. |
| **Logo** | FR-45 | Uploaded image (SVG/PNG); rendered in the top bar and login. A monochrome variant for small/dark contexts is optional. |
| **Favicon** | FR-45 | Uploaded; injected as the tab icon and PWA icon. |
| **Color palette** | FR-46 | `primary`, `accent`, `background`, `surface`, `text` (with sensible derived hover/border shades). |
| **Theme style** | FR-46 | A named preset (e.g. *Midnight*, *Paper*, *Neon*, *Slate*) that sets the palette + radius + density defaults. |
| **Light/dark mode** | FR-46 | `mode: light \| dark \| system`. |
| **Fonts** | FR-47 | Heading + body chosen from bundled fonts, or a provided web-font file. |

## 2. Branding payload

Stored as `settings['branding']`, validated by a zod schema; served (public) by
`GET /api/branding` so even the login screen is branded:

```json
{
  "siteName": "Dawson's Library",
  "logoUrl": "/api/branding/asset/logo",
  "faviconUrl": "/api/branding/asset/favicon",
  "theme": "midnight",
  "mode": "dark",
  "colors": {
    "primary": "#7c3aed", "accent": "#22d3ee",
    "background": "#0b0b10", "surface": "#16161d", "text": "#e7e7ea"
  },
  "fonts": { "heading": "Inter", "body": "Inter", "headingUrl": null, "bodyUrl": null },
  "radius": "0.75rem"
}
```

## 3. Admin flow (`<BrandingEditor>`)

1. **Pick a preset** → fills colors/fonts/radius; a **live preview** pane re-renders the
   app chrome with the choices in real time (no save needed to preview).
2. **Fine-tune** individual colors (color pickers with contrast hints), mode, radius,
   density, and fonts.
3. **Upload assets** (logo, favicon, optional font) via
   `POST /api/admin/branding/asset` (multipart); files are validated (type, size) and
   stored under `data/branding/`, returning stable URLs.
4. **Save** → `PUT /api/admin/branding`; the change is broadcast/applied app-wide
   immediately (FR-48). **Reset to default** restores the shipped theme.

## 4. Applying branding (runtime)

On load, `<ThemeProvider>` fetches `GET /api/branding`, writes the palette/fonts/radius to
`:root` as `--fw-*` CSS variables, sets the document title and favicon, and updates the PWA
manifest name/icons where the platform allows. Because Tailwind's semantic colors resolve
to those variables (frontend §5), every component restyles without a rebuild. A default
theme renders before the payload arrives (using `prefers-color-scheme`) to avoid a flash.

## 5. Constraints & validation

- Asset uploads: allowed types (`svg`, `png`, `jpg`, `webp`, `ico`, `woff2`), max size
  (config, e.g. 2 MB), dimension sanity for favicons; SVGs sanitized before serving.
- Colors validated as hex/RGB; the editor warns on low text/background contrast (WCAG AA)
  but does not block (owner's choice).
- Branding persists in the DB (NFR-11) and survives restarts/upgrades; assets live on the
  `data/` volume.

## 6. Acceptance

An admin sets a site name, uploads a logo and favicon, picks a preset, tweaks the primary
color, and the entire app — including the login page and browser tab — reflects it
immediately and after a restart, with no code change or rebuild. Traces FR-45–48.
