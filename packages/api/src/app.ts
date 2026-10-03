import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
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
import { seedRepositories } from './lib/seed-repositories'
import { runInternalCommand, seedInternalCommands } from './lib/internal-commands'
import { JobWorker } from './workers/worker'
import { EventHub } from './services/events'
import { WatcherManager } from './services/watcher'
import { runScan } from './services/scanner'
import { createFfprobe, type Prober } from './services/ffprobe'
import { createThumbnailer, type Thumbnailer } from './services/thumbnailer'
import { createImageVariantMaker, type ImageVariantMaker } from './services/images'
import { createFrameGrabber, type FrameGrabber } from './services/frame-grabber'
import { createCaptionConverter, type CaptionConverter } from './services/captions'
import { TranscodeManager, createTranscodeStarter, type TranscodeStarter } from './services/transcode'
import { createClipExporter, type ClipExporter } from './services/clip-export'
import { CommandRunner } from './services/command-runner'
import { PluginHost } from './services/plugin-host'
import { emitPluginEvent } from './services/plugin-events'
import { resolveWithinRoot } from './lib/path-safety'
import { enqueueJob } from './services/jobs'
import { jobs, repositories, mediaItems, clips, commands, commandRuns } from './db/schema'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { adminUserRoutes } from './routes/admin/users'
import { adminRepositoryRoutes } from './routes/admin/repositories'
import { mediaRoutes } from './routes/media'
import { tagRoutes } from './routes/tags'
import { categoryRoutes } from './routes/categories'
import { playbackRoutes } from './routes/playback'
import { likeRoutes } from './routes/likes'
import { collectionRoutes } from './routes/collections'
import { clipRoutes } from './routes/clips'
import { brandingRoutes, adminBrandingRoutes } from './routes/branding'
import { adminCommandRoutes, commandRoutes } from './routes/commands'
import { adminPluginRoutes, pluginRoutes } from './routes/plugins'
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
  /** Injectable single-frame grabber for /frame?t= scrub previews (tests pass a fake). */
  frameGrabber?: FrameGrabber
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
    frameGrabber: FrameGrabber
    commandRunner: CommandRunner
    pluginHost: PluginHost
  }
}

const here = dirname(fileURLToPath(import.meta.url))

export async function buildApp(
  overrides: Partial<AppConfig> = {},
  deps: AppDeps = {},
): Promise<FastifyInstance> {
  const config: AppConfig = { ...loadConfig(), ...overrides }
  // Default seed file lives at the repo root; `here` is packages/api/{src,dist} in dev/prod.
  config.repositoriesFile ??= join(here, '..', '..', '..', 'config', 'repositories.yaml')
  const prober: Prober = deps.prober ?? createFfprobe()
  const thumbnailer: Thumbnailer = deps.thumbnailer ?? createThumbnailer()
  const captionConverter: CaptionConverter = deps.captionConverter ?? createCaptionConverter()
  const imageVariant: ImageVariantMaker = deps.imageVariant ?? createImageVariantMaker()
  const frameGrabber: FrameGrabber = deps.frameGrabber ?? createFrameGrabber()
  const transcodeStarter: TranscodeStarter =
    deps.transcodeStarter ??
    createTranscodeStarter('ffmpeg', { maxHeight: config.transcodeMaxHeight, maxrateMbps: config.transcodeMaxrateMbps })
  const clipExporter: ClipExporter = deps.clipExporter ?? createClipExporter()

  const serverOptions: FastifyServerOptions = {
    loggerInstance: createLogger(config.env, config.logLevel),
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: config.trustProxy, // behind the Tailscale Serve TLS proxy (X-Forwarded-*)
  }
  if (config.tls) {
    // Native TLS: read the PEM cert/key and let Fastify create an HTTPS server. `req.protocol`
    // is then 'https', so the session cookie is marked Secure and HSTS is sent automatically.
    let key: Buffer
    let cert: Buffer
    try {
      key = readFileSync(config.tls.keyFile)
      cert = readFileSync(config.tls.certFile)
    } catch (e) {
      throw new Error(
        `Cannot read TLS files (${config.tls.certFile} / ${config.tls.keyFile}): ${(e as Error).message}. ` +
          'On Windows, use forward slashes in TLS_CERT_FILE/TLS_KEY_FILE (e.g. C:/path/cert.crt) — ' +
          'backslashes are often stripped when setting env vars.',
      )
    }
    ;(serverOptions as FastifyServerOptions & { https: { key: Buffer; cert: Buffer } }).https = { key, cert }
  }
  const app = Fastify(serverOptions)

  // Security headers / CSP (security §7). The SPA uses no inline scripts (Vite emits external
  // hashed bundles); style attributes need 'unsafe-inline'. Media/posters/HLS and the WebSocket
  // are same-origin.
  //
  // IMPORTANT: Free-WAN is commonly reached over **plain HTTP** on the tailnet (direct
  // <tailscale-ip>:<port>), with TLS optionally provided by Tailscale Serve. So we must NOT send
  // `upgrade-insecure-requests` — over HTTP it makes browsers upgrade every subresource (JS/CSS)
  // to HTTPS the server can't answer, leaving a blank page (notably on iOS WebKit). And HSTS is
  // sent only when the request is actually HTTPS, so a one-time HTTPS visit can't pin the host to
  // HTTPS and break later HTTP access.
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
        upgradeInsecureRequests: null, // do not force HTTPS on subresources (see note above)
      },
    },
    hsts: false, // set conditionally below (HTTPS only)
    crossOriginEmbedderPolicy: false,
  })

  // HSTS only over HTTPS (e.g. behind Tailscale Serve). Over plain HTTP it's ignored by browsers
  // anyway, but omitting it avoids accidentally pinning the host to HTTPS.
  app.addHook('onSend', async (req, reply) => {
    if (req.protocol === 'https') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
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
      onIndexed: (itemId, type) => {
        enqueueJob(db, 'thumbnail', { mediaItemId: itemId }, 0)
        // Plugin trigger: a newly indexed item (docs/13-plugins.md). No-ops with no subscribers.
        emitPluginEvent(app, 'media.added', { mediaItemId: itemId, type })
      },
    })
    // Persist the result counts back onto the job payload for GET /…/scan to read.
    const merged = { ...(ctx.payload as object), result }
    db.update(jobs).set({ payload: JSON.stringify(merged) }).where(eq(jobs.id, ctx.jobId)).run()
    emitPluginEvent(app, 'scan.completed', { repositoryId, ...result })
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
    if (cmd.isInternal) {
      // Built-ins run in-process — nothing is spawned.
      await runInternalCommand(app, run, cmd)
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
  // Plugin host: sandboxed child processes + mediated Host API (docs/13-plugins.md). The forked
  // runtime is a sibling of both src/ (dev) and dist/ (prod), like the migrations folder.
  const pluginHost = new PluginHost({
    db,
    events,
    log: app.log,
    dataDir: config.dataDir,
    runtimePath: join(here, '..', 'runtime', 'plugin-runtime.mjs'),
  })
  app.decorate('pluginHost', pluginHost)
  worker.register('plugin_command', async (ctx) => {
    const { runId, pluginId, command, args } = ctx.payload as {
      runId: string
      pluginId: string
      command: string
      args: Record<string, unknown>
    }
    await pluginHost.runCommand(runId, pluginId, command, args, config.pluginTimeoutS * 1000)
  })
  worker.register('plugin_event', async (ctx) => {
    const { runId, pluginId, event, payload } = ctx.payload as {
      runId: string
      pluginId: string
      event: string
      payload: unknown
    }
    await pluginHost.dispatchEvent(runId, pluginId, event, payload, config.pluginTimeoutS * 1000)
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
  app.decorate('frameGrabber', frameGrabber)

  const transcoder = new TranscodeManager(config.dataDir, transcodeStarter, app.log, {
    idleMs: 60_000,
    sweep: config.env !== 'test',
    maxCacheBytes: config.transcodeCacheMaxMb * 1024 * 1024,
    prober,
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
    await pluginHost.stopAll()
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
  await app.register(tagRoutes)
  await app.register(categoryRoutes)
  await app.register(playbackRoutes)
  await app.register(likeRoutes)
  await app.register(collectionRoutes)
  await app.register(clipRoutes)
  await app.register(brandingRoutes)
  await app.register(adminBrandingRoutes)
  await app.register(adminCommandRoutes)
  await app.register(commandRoutes)
  await app.register(adminPluginRoutes)
  await app.register(pluginRoutes)
  await app.register(adminSystemRoutes)
  await app.register(adminUpdateRoutes)
  await app.register(uploadRoutes)
  await app.register(wsRoutes)

  // First-run admin bootstrap (idempotent), then start watchers for existing repos.
  await bootstrapAdmin(app)
  // First-run repository seeding from config/repositories.yaml (one-shot, FR-02).
  seedRepositories(app)
  // Built-in maintenance commands (idempotent).
  seedInternalCommands(app)
  // Finalize a self-update that just restarted us (marks the changelog entry "success").
  reconcilePendingUpdate(app)
  watchers.sync()
  // Bring already-enabled plugins online (daemons activate; others idle until invoked).
  if (config.pluginsEnabled) pluginHost.startEnabled()

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
