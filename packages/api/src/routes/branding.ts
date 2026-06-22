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

export async function brandingRoutes(app: FastifyInstance): Promise<void> {
  // PUBLIC — the login screen is branded too.
  app.get('/api/branding', async () => getBranding(app.db))

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

    const url = `/api/branding/asset/${kind}`
    const current = getBranding(app.db)
    setBranding(app.db, { ...current, [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: url })
    return reply.send({ url })
  })
}
