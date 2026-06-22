import { existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyWebsocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import fastifyHelmet from '@fastify/helmet'
import { eq } from 'drizzle-orm'
import { loadConfig, type AppConfig } from './lib/config'
import { createLogger } from './lib/logger'
import { openDatabase, type Db } from './db/client'
import { runMigrations } from './db/migrate'
import { authPlugin } from './plugins/auth'
import { bootstrapAdmin } from './lib/bootstrap'
import { JobWorker } from './workers/worker'
import { EventHub } from './services/events'
import { WatcherManager } from './services/watcher'
import { runScan } from './services/scanner'
import { createFfprobe, type Prober } from './services/ffprobe'
import { createThumbnailer, type Thumbnailer } from './services/thumbnailer'
import { createImageVariantMaker, type ImageVariantMaker } from './services/images'
import { createCaptionConverter, type CaptionConverter } from './services/captions'
import { TranscodeManager, createTranscodeStarter, type TranscodeStarter } from './services/transcode'
import { createClipExporter, type ClipExporter } from './services/clip-export'
import { CommandRunner } from './services/command-runner'
import { resolveWithinRoot } from './lib/path-safety'
import { enqueueJob } from './services/jobs'
import { jobs, repositories, mediaItems, clips, commands, commandRuns } from './db/schema'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { adminUserRoutes } from './routes/admin/users'
import { adminRepositoryRoutes } from './routes/admin/repositories'
import { mediaRoutes } from './routes/media'
import { categoryRoutes } from './routes/categories'
import { playbackRoutes } from './routes/playback'
import { likeRoutes } from './routes/likes'
import { collectionRoutes } from './routes/collections'
import { clipRoutes } from './routes/clips'
import { brandingRoutes, adminBrandingRoutes } from './routes/branding'
import { adminCommandRoutes, commandRoutes } from './routes/commands'
import { adminSystemRoutes } from './routes/admin/system'
import { adminUpdateRoutes } from './routes/admin/updates'
import { reconcilePendingUpdate } from './services/update-reconcile'
import { uploadRoutes } from './routes/uploads'
import { wsRoutes } from './routes/ws'

export interface AppDeps {
  /** Injectable ffprobe-backed prober (tests pass a fake). */
  prober?: Prober
  /** Injectable thumbnailer (tests pass a fake). */
  thumbnailer?: Thumbnailer
  /** Injectable image-variant resizer for /raw?w= (tests pass a fake). */
  imageVariant?: ImageVariantMaker
  /** Injectable subtitle→WebVTT converter (tests pass a fake). */
  captionConverter?: CaptionConverter
  /** Injectable HLS transcode starter (tests pass a fake). */
  transcodeStarter?: TranscodeStarter
  /** Injectable clip exporter (tests pass a fake). */
  clipExporter?: ClipExporter
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
    db: Db
    worker: JobWorker
    events: EventHub
    watchers: WatcherManager
    captionConverter: CaptionConverter
    transcoder: TranscodeManager
    imageVariant: ImageVariantMaker
    commandRunner: CommandRunner
  }
}

const here = dirname(fileURLToPath(import.meta.url))

export async function buildApp(
  overrides: Partial<AppConfig> = {},
  deps: AppDeps = {},
): Promise<FastifyInstance> {
  const config: AppConfig = { ...loadConfig(), ...overrides }
  const prober: Prober = deps.prober ?? createFfprobe()
  const thumbnailer: Thumbnailer = deps.thumbnailer ?? createThumbnailer()
  const captionConverter: CaptionConverter = deps.captionConverter ?? createCaptionConverter()
  const imageVariant: ImageVariantMaker = deps.imageVariant ?? createImageVariantMaker()
  const transcodeStarter: TranscodeStarter = deps.transcodeStarter ?? createTranscodeStarter()
  const clipExporter: ClipExporter = deps.clipExporter ?? createClipExporter()

  const app = Fastify({
    loggerInstance: createLogger(config.env, config.logLevel),
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: config.trustProxy, // behind the Tailscale Serve TLS proxy
  })

  // Security headers / CSP / HSTS (security §7). The SPA uses no inline scripts (Vite emits
  // external hashed bundles); style attributes need 'unsafe-inline'. Media/posters/HLS and
  // the WebSocket are same-origin.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    crossOriginEmbedderPolicy: false,
  })

  // Database + migrations. `here` is src/ in dev and dist/ in prod; the migrations
  // folder lives one level up from both (packages/api/migrations).
  const { db, sqlite } = openDatabase(config.dataDir)
  runMigrations(sqlite, join(here, '..', 'migrations'))

  app.decorate('config', config)
  app.decorate('db', db)

  // Realtime event hub (scan/job/run topics → WebSocket subscribers).
  const events = new EventHub()
  app.decorate('events', events)

  // In-process job worker (scan/probe/thumbnail/transcode/clip_export live here).
  const worker = new JobWorker(db, app.log)
  worker.register('scan', async (ctx) => {
    const { repositoryId } = ctx.payload as { repositoryId: string }
    const result = await runScan(db, repositoryId, prober, {
      setProgress: ctx.setProgress,
      log: ctx.log,
      onProgress: (snapshot) =>
        events.publish(`scan:${repositoryId}`, { type: 'scan', repositoryId, ...snapshot }),
      onIndexed: (itemId) => enqueueJob(db, 'thumbnail', { mediaItemId: itemId }, 0),
    })
    // Persist the result counts back onto the job payload for GET /…/scan to read.
    const merged = { ...(ctx.payload as object), result }
    db.update(jobs).set({ payload: JSON.stringify(merged) }).where(eq(jobs.id, ctx.jobId)).run()
  })
  worker.register('thumbnail', async (ctx) => {
    const { mediaItemId } = ctx.payload as { mediaItemId: string }
    const item = db.select().from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get()
    if (!item || item.status !== 'active') return
    const repo = db.select().from(repositories).where(eq(repositories.id, item.repositoryId)).get()
    if (!repo) return
    const absPath = join(repo.rootPath, ...item.relPath.split('/'))
    const outDir = join(config.dataDir, 'thumbs', item.id)
    const { posterPath } = await thumbnailer({
      absPath,
      type: item.type,
      durationS: item.durationS,
      outDir,
    })
    const rel = relative(config.dataDir, posterPath).split(sep).join('/')
    db.update(mediaItems).set({ posterPath: rel, updatedAt: Date.now() }).where(eq(mediaItems.id, item.id)).run()
  })
  worker.register('clip_export', async (ctx) => {
    const { clipId, format } = ctx.payload as { clipId: string; format: 'mp4' | 'gif' }
    const clip = db.select().from(clips).where(eq(clips.id, clipId)).get()
    if (!clip) return
    const src = clip.sourceItemId
      ? db.select().from(mediaItems).where(eq(mediaItems.id, clip.sourceItemId)).get()
      : undefined
    const repo = src ? db.select().from(repositories).where(eq(repositories.id, src.repositoryId)).get() : undefined
    const fail = () => db.update(clips).set({ exportStatus: 'failed', updatedAt: Date.now() }).where(eq(clips.id, clipId)).run()
    if (!src || !repo || src.status !== 'active') {
      fail()
      throw new Error('clip source unavailable')
    }
    try {
      db.update(clips).set({ exportStatus: 'rendering', updatedAt: Date.now() }).where(eq(clips.id, clipId)).run()
      events.publish(`job:${ctx.jobId}`, { type: 'job', jobId: ctx.jobId, jobType: 'clip_export', status: 'running', progress: 0.1 })
      const abs = resolveWithinRoot(repo.rootPath, src.relPath)
      const outDir = join(config.dataDir, 'exports')
      mkdirSync(outDir, { recursive: true })
      const outPath = join(outDir, `${clipId}.${format}`)
      await clipExporter({ absPath: abs, startS: clip.startS, endS: clip.endS, format, outPath })
      const rel = relative(config.dataDir, outPath).split(sep).join('/')
      db.update(clips).set({ exportStatus: 'ready', exportPath: rel, updatedAt: Date.now() }).where(eq(clips.id, clipId)).run()
      events.publish(`job:${ctx.jobId}`, { type: 'job', jobId: ctx.jobId, jobType: 'clip_export', status: 'succeeded', progress: 1 })
    } catch (e) {
      fail()
      throw e
    }
  })
  // Sandboxed command runner (security §5).
  const commandRunner = new CommandRunner(db, events, app.log)
  app.decorate('commandRunner', commandRunner)
  worker.register('command_run', async (ctx) => {
    const { runId } = ctx.payload as { runId: string }
    const run = db.select().from(commandRuns).where(eq(commandRuns.id, runId)).get()
    if (!run || run.status !== 'queued') return
    const cmd = db.select().from(commands).where(eq(commands.id, run.commandId)).get()
    if (!cmd) {
      db.update(commandRuns).set({ status: 'failed', finishedAt: Date.now() }).where(eq(commandRuns.id, runId)).run()
      return
    }
    const argv = JSON.parse(run.resolvedArgv) as string[]
    const envAllow = JSON.parse(cmd.envAllowlist) as string[]
    // Minimal allowlisted env — server secrets are NOT inherited (security §5).
    const env: NodeJS.ProcessEnv = {}
    for (const k of ['PATH', 'HOME', ...envAllow]) {
      if (process.env[k] !== undefined) env[k] = process.env[k]
    }
    const cwd =
      cmd.workingDir && existsSync(cmd.workingDir) && statSync(cmd.workingDir).isDirectory()
        ? cmd.workingDir
        : mkdtempSync(join(tmpdir(), 'fw-cmd-'))
    await commandRunner.run({
      runId,
      executable: cmd.executable,
      argv,
      cwd,
      env,
      timeoutS: cmd.timeoutS,
      maxOutputKb: cmd.maxOutputKb,
    })
  })
  app.decorate('worker', worker)

  // Filesystem watcher → debounced incremental rescan (FR-13). Disabled under tests.
  const watchers = new WatcherManager(
    db,
    app.log,
    (repoId) => {
      enqueueJob(db, 'scan', { repositoryId: repoId }, 5)
      worker.kick()
    },
    { enabled: config.env !== 'test', debounceMs: config.watchDebounceMs },
  )
  app.decorate('watchers', watchers)
  app.decorate('captionConverter', captionConverter)
  app.decorate('imageVariant', imageVariant)

  const transcoder = new TranscodeManager(config.dataDir, transcodeStarter, app.log, {
    idleMs: 60_000,
    sweep: config.env !== 'test',
  })
  app.decorate('transcoder', transcoder)

  // Scheduled full-rescan backstop (also recovers offline→online). Disabled under tests.
  let rescanTimer: ReturnType<typeof setInterval> | undefined
  if (config.env !== 'test' && config.rescanIntervalMin > 0) {
    rescanTimer = setInterval(
      () => {
        for (const r of db.select().from(repositories).all()) {
          if (r.enabled) enqueueJob(db, 'scan', { repositoryId: r.id }, 1)
        }
        worker.kick()
      },
      config.rescanIntervalMin * 60_000,
    )
  }

  app.addHook('onClose', async () => {
    worker.stop()
    if (rescanTimer) clearInterval(rescanTimer)
    await watchers.stopAll()
    await transcoder.stopAll()
    commandRunner.stopAll()
    sqlite.close()
  })

  // Auth infrastructure: signed cookies, login rate-limiting, session middleware.
  await app.register(fastifyCookie, { secret: config.sessionSecret })
  await app.register(fastifyRateLimit, { global: false })
  await app.register(fastifyWebsocket)
  await app.register(fastifyMultipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } })
  await app.register(authPlugin)

  // Routes
  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(adminUserRoutes)
  await app.register(adminRepositoryRoutes)
  await app.register(mediaRoutes)
  await app.register(categoryRoutes)
  await app.register(playbackRoutes)
  await app.register(likeRoutes)
  await app.register(collectionRoutes)
  await app.register(clipRoutes)
  await app.register(brandingRoutes)
  await app.register(adminBrandingRoutes)
  await app.register(adminCommandRoutes)
  await app.register(commandRoutes)
  await app.register(adminSystemRoutes)
  await app.register(adminUpdateRoutes)
  await app.register(uploadRoutes)
  await app.register(wsRoutes)

  // First-run admin bootstrap (idempotent), then start watchers for existing repos.
  await bootstrapAdmin(app)
  // Finalize a self-update that just restarted us (marks the changelog entry "success").
  reconcilePendingUpdate(app)
  watchers.sync()

  // Serve the built frontend in production, with SPA fallback for client routes.
  // We check for index.html specifically: an empty/partial dist dir would pass an
  // existsSync(dir) check but then 404 on sendFile, producing a confusing "cannot GET /".
  const webDist = join(here, '..', '..', 'web', 'dist')
  const webBuilt = existsSync(join(webDist, 'index.html'))
  if (webBuilt) {
    app.log.info(`Serving web UI from ${webDist}`)
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      cacheControl: false,
      // index.html must always be revalidated so a client never holds a stale copy that
      // points at a hashed chunk a later build removed (the classic blank-page-after-update).
      // Hashed assets are content-addressed, so they can cache forever.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache')
        } else if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } })
      }
      return reply.sendFile('index.html')
    })
  } else {
    // The API is up but there is no frontend to serve. Make this loud, and give a
    // helpful response at non-API routes instead of Fastify's bare "Route GET:/ not found".
    app.log.warn(
      `Web UI not found at ${webDist} — the API is running but no frontend will be served. ` +
        `Build it with "pnpm --filter @free-wan/web build" then restart (or rebuild the Docker ` +
        `image). In development, open the Vite dev server (http://localhost:5173), not the API port.`,
    )
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } })
      }
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .send(
          'Free-WAN API is running, but the web UI has not been built.\n\n' +
            'Fix one of these:\n' +
            '  • Build the frontend:  pnpm --filter @free-wan/web build   (then restart the server)\n' +
            '  • Or rebuild the Docker image so the build stage runs.\n' +
            '  • In development, open the Vite dev server at http://localhost:5173 instead of this port.\n',
        )
    })
  }

  return app
}
