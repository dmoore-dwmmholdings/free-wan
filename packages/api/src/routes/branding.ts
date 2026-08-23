import { createReadStream, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { updateBrandingRequestSchema, type Branding } from '@free-wan/shared'
import { getBranding, setBranding } from '../services/branding'
import { sanitizeSvg } from '../lib/sanitize-svg'

const ALLOWED: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}
const CONTENT_TYPE: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
}
const MAX_ASSET_BYTES = 2 * 1024 * 1024

function brandingDir(app: FastifyInstance): string {
  return join(app.config.dataDir, 'branding')
}
function findAsset(app: FastifyInstance, kind: string): string | null {
  const dir = brandingDir(app)
  if (!existsSync(dir)) return null
  const match = readdirSync(dir).find((f) => f.startsWith(`${kind}.`))
  return match ? join(dir, match) : null
}

/** Perceptual luminance of a #rgb/#rrggbb(aa) hex color, 0..1. */
function luminance(hex: string): number {
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** Fallback PWA icon when no SVG logo is uploaded: the site's initial on the brand color. */
function monogramSvg(siteName: string, primary: string): string {
  const letter = (siteName.trim()[0] ?? 'F').toUpperCase().replace(/[&<>'"]/g, '')
  const fg = luminance(primary) > 0.6 ? '#16161d' : '#ffffff'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="64" fill="${primary}"/>` +
    `<text x="256" y="276" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="system-ui, sans-serif" font-size="280" font-weight="700" fill="${fg}">${letter || 'F'}</text>` +
    `</svg>`
  )
}

export async function brandingRoutes(app: FastifyInstance): Promise<void> {
  // PUBLIC — the login screen is branded too.
  app.get('/api/branding', async () => getBranding(app.db))

  // Web app manifest, built from the live branding so an installed app carries the owner's
  // name and colors. Served under /api (dev proxy + no SPA-fallback clash); the explicit
  // scope:'/' overrides the default manifest-directory scope, which manifests (unlike
  // service workers) are allowed to widen.
  app.get('/api/manifest.webmanifest', async (req, reply) => {
    const b = getBranding(app.db)
    reply.type('application/manifest+json').header('Cache-Control', 'no-cache')
    return {
      name: b.siteName,
      short_name: b.siteName.length > 12 ? `${b.siteName.slice(0, 11).trimEnd()}…` : b.siteName,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: b.colors.background,
      theme_color: b.colors.background,
      icons: [
        { src: '/api/branding/pwa-icon', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/api/branding/pwa-icon', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      ],
    }
  })

  // Manifest icon: the uploaded logo when it is an SVG (rasters can't claim sizes:'any'),
  // otherwise a generated monogram. Always SVG, so the manifest entry stays truthful.
  app.get('/api/branding/pwa-icon', async (req, reply) => {
    reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=300')
    const logo = findAsset(app, 'logo')
    if (logo && logo.endsWith('.svg')) return reply.send(createReadStream(logo))
    const b = getBranding(app.db)
    return reply.send(monogramSvg(b.siteName, b.colors.primary))
  })

  app.get('/api/branding/asset/:kind', async (req, reply) => {
    const { kind } = req.params as { kind: string }
    if (kind !== 'logo' && kind !== 'favicon') {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Unknown asset' } })
    }
    const path = findAsset(app, kind)
    if (!path) return reply.code(404).send({ error: { code: 'not_found', message: 'No asset' } })
    const ext = path.slice(path.lastIndexOf('.') + 1)
    reply.type(CONTENT_TYPE[ext] ?? 'application/octet-stream').header('Cache-Control', 'public, max-age=300')
    return reply.send(createReadStream(path))
  })
}

export async function adminBrandingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAdmin)

  app.put('/api/admin/branding', async (req, reply) => {
    const parsed = updateBrandingRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'Invalid branding' } })
    }
    const current = getBranding(app.db)
    const next: Branding = {
      ...current,
      ...parsed.data,
      colors: { ...current.colors, ...parsed.data.colors },
      fonts: { ...current.fonts, ...parsed.data.fonts },
    }
    setBranding(app.db, next)
    return next
  })

  app.post('/api/admin/branding/asset', async (req, reply) => {
    const kind = (req.query as { kind?: string }).kind
    if (kind !== 'logo' && kind !== 'favicon') {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'kind must be logo|favicon' } })
    }
    const part = await req.file({ limits: { fileSize: MAX_ASSET_BYTES } })
    if (!part) return reply.code(422).send({ error: { code: 'validation_error', message: 'No file' } })
    const ext = ALLOWED[part.mimetype]
    if (!ext) {
      return reply.code(422).send({ error: { code: 'validation_error', message: `Unsupported type ${part.mimetype}` } })
    }

    let buf = await part.toBuffer()
    if (part.file.truncated || buf.length > MAX_ASSET_BYTES) {
      return reply.code(413).send({ error: { code: 'validation_error', message: 'File too large' } })
    }
    if (ext === 'svg') buf = Buffer.from(sanitizeSvg(buf.toString('utf8')), 'utf8')

    const dir = brandingDir(app)
    mkdirSync(dir, { recursive: true })
    // Replace any prior variant of this asset (different extension).
    for (const f of existsSync(dir) ? readdirSync(dir) : []) {
      if (f.startsWith(`${kind}.`)) await rm(join(dir, f), { force: true })
    }
    await writeFile(join(dir, `${kind}.${ext}`), buf)

    // Version the URL so a re-upload changes it — otherwise the browser keeps serving the cached
    // favicon/logo from the old (identical) path and the change appears not to take.
    const url = `/api/branding/asset/${kind}?v=${Date.now()}`
    const current = getBranding(app.db)
    setBranding(app.db, { ...current, [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: url })
    return reply.send({ url })
  })
}
