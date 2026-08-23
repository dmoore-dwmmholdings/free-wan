import { fork, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyBaseLogger } from 'fastify'
import {
  uiViewSchema,
  MAX_CLIP_SECONDS,
  type PluginPermission,
  type UiView,
} from '@free-wan/shared'
import type { Db } from '../db/client'
import {
  plugins,
  pluginKv,
  pluginRuns,
  mediaItems,
  repositories,
  categories,
  collections,
  collectionItems,
  clips,
  type PluginRow,
} from '../db/schema'
import type { EventHub } from './events'

const READY_TIMEOUT_MS = 15_000
const UI_TIMEOUT_MS = 15_000
const MAX_LOG_BYTES = 256 * 1024
const MAX_RESTARTS = 5

// Host API method -> permission it requires (null = always allowed). config.get is resolved
// inside the runtime from the config snapshot, so it never reaches the host.
const PERMISSION_FOR: Record<string, PluginPermission | null> = {
  'media.list': 'media:read',
  'media.get': 'media:read',
  'media.count': 'media:read',
  'repos.list': 'media:read',
  'categories.list': 'media:read',
  'collections.list': 'collections:write',
  'collections.create': 'collections:write',
  'collections.addItem': 'collections:write',
  'clips.create': 'clips:write',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.delete': 'storage',
  'storage.list': 'storage',
  notify: 'notify',
}

// Minimal, cross-platform env baseline. Server secrets are NOT inherited (security §5); a plugin
// only gets what `node` needs to run plus the env names its manifest explicitly allowlists.
const BASE_ENV_KEYS = [
  'PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
  // Common config/cache locations so spawned tools (e.g. yt-dlp) behave on Windows. Not secrets.
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PATHEXT',
]

interface PendingInvoke {
  resolve: (v: { value: unknown; logs: string }) => void
  reject: (e: Error) => void
  logs: string[]
  bytes: number
  timer: ReturnType<typeof setTimeout>
}

interface InvokeResult {
  value: unknown
  logs: string
}

/** A single live plugin child process + its IPC correlation state. */
class PluginProcess {
  ready: Promise<void>
  /** Resolves when the child process has actually exited (used to gate file deletion). */
  exited: Promise<void>
  private resolveExited!: () => void
  private resolveReady!: () => void
  private rejectReady!: (e: Error) => void
  private settledReady = false
  private readonly pending = new Map<string, PendingInvoke>()
  private seq = 0
  killed = false

  constructor(
    readonly child: ChildProcess,
    private readonly host: PluginHost,
    readonly row: PluginRow,
    private readonly permissions: Set<PluginPermission>,
  ) {
    this.ready = new Promise<void>((res, rej) => {
      this.resolveReady = res
      this.rejectReady = rej
    })
    this.exited = new Promise<void>((res) => {
      this.resolveExited = res
    })
    child.on('message', (m) => this.onMessage(m as Record<string, unknown>))
    child.stdout?.on('data', (d: Buffer) => host.logChild(row.id, 'stdout', d.toString()))
    child.stderr?.on('data', (d: Buffer) => host.logChild(row.id, 'stderr', d.toString()))
    child.on('exit', (code) => this.onExit(code))
    child.on('error', (e) => this.onExit(null, e))
  }

  private settleReady(err?: Error): void {
    if (this.settledReady) return
    this.settledReady = true
    if (err) this.rejectReady(err)
    else this.resolveReady()
  }

  private onMessage(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'ready':
        this.settleReady()
        return
      case 'fatal':
        this.settleReady(new Error(String(m.error ?? 'plugin failed to load')))
        return
      case 'log': {
        const invokeId = m.invokeId as string | null
        const line = String(m.msg ?? '')
        const p = invokeId ? this.pending.get(invokeId) : undefined
        if (p && p.bytes < MAX_LOG_BYTES) {
          p.logs.push(line)
          p.bytes += line.length
        }
        this.host.log.debug(`[plugin ${this.row.id}] ${line}`)
        return
      }
      case 'invoke.result': {
        const id = m.id as string
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        clearTimeout(p.timer)
        const logs = p.logs.join('\n')
        if (m.ok) p.resolve({ value: m.value, logs })
        else p.reject(Object.assign(new Error(String(m.error ?? 'plugin error')), { logs }))
        return
      }
      case 'api': {
        void this.handleApi(m.id as string, m.method as string, (m.params as Record<string, unknown>) ?? {})
        return
      }
    }
  }

  private onExit(code: number | null, err?: Error): void {
    const reason = err ? err.message : `process exited (code ${code})`
    this.resolveExited()
    this.settleReady(new Error(reason))
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
    this.host.onProcessExit(this.row.id, this, reason)
  }

  send(m: Record<string, unknown>): void {
    try {
      this.child.send(m)
    } catch {
      /* dead channel */
    }
  }

  invoke(kind: string, payload: unknown, timeoutMs: number): Promise<InvokeResult> {
    const id = `i${++this.seq}`
    return new Promise<InvokeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(Object.assign(new Error(`plugin ${kind} timed out after ${timeoutMs}ms`), { timeout: true }))
        // A hung invoke can wedge the plugin; recycle the process.
        this.host.recycle(this.row.id)
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, logs: [], bytes: 0, timer })
      this.send({ t: 'invoke', id, kind, payload })
    })
  }

  kill(): void {
    this.killed = true
    try {
      this.child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      try {
        if (!this.child.killed) this.child.kill('SIGKILL')
      } catch {
        /* gone */
      }
    }, 2000).unref?.()
  }

  // ---- Host API (plugin -> host), permission-gated ----
  private async handleApi(id: string, method: string, params: Record<string, unknown>): Promise<void> {
    try {
      const required = PERMISSION_FOR[method]
      if (required === undefined) throw new Error(`unknown host method: ${method}`)
      if (required && !this.permissions.has(required)) {
        throw new Error(`permission "${required}" not granted (declare it in plugin.json)`)
      }
      const value = await this.host.dispatchApi(this.row, method, params)
      this.send({ t: 'api.result', id, ok: true, value })
    } catch (e) {
      this.send({ t: 'api.result', id, ok: false, error: (e as Error).message })
    }
  }
}

export interface PluginHostDeps {
  db: Db
  events: EventHub
  log: FastifyBaseLogger
  dataDir: string
  /** Absolute path to runtime/plugin-runtime.mjs. */
  runtimePath: string
}

/**
 * Manages the lifecycle of plugin child processes and mediates the Host API. One live process per
 * enabled plugin; daemons are activated on start and auto-restarted on crash, others start lazily
 * on first invocation. Analogous to TranscodeManager / CommandRunner.
 */
export class PluginHost {
  readonly db: Db
  readonly events: EventHub
  readonly log: FastifyBaseLogger
  private readonly dataDir: string
  private readonly runtimePath: string
  private readonly procs = new Map<string, PluginProcess>()
  private readonly starting = new Map<string, Promise<PluginProcess>>()
  private readonly restarts = new Map<string, number>()
  private stopped = false

  constructor(deps: PluginHostDeps) {
    this.db = deps.db
    this.events = deps.events
    this.log = deps.log
    this.dataDir = deps.dataDir
    this.runtimePath = deps.runtimePath
  }

  /** Boot: start every enabled plugin (daemons activate; others idle until invoked). */
  startEnabled(): void {
    const rows = this.db.select().from(plugins).where(eq(plugins.enabled, 1)).all()
    for (const row of rows) {
      this.ensureStarted(row.id).catch((e) =>
        this.log.warn(`plugin ${row.id} failed to start: ${(e as Error).message}`),
      )
    }
  }

  logChild(pluginId: string, stream: string, text: string): void {
    const t = text.trimEnd()
    if (t) this.log.debug(`[plugin ${pluginId}:${stream}] ${t}`)
  }

  private getRow(pluginId: string): PluginRow | undefined {
    return this.db.select().from(plugins).where(eq(plugins.id, pluginId)).get()
  }

  /** Return a ready process for an enabled plugin, starting it if necessary (serialized). */
  ensureStarted(pluginId: string): Promise<PluginProcess> {
    const live = this.procs.get(pluginId)
    if (live && !live.killed) return live.ready.then(() => live)
    const inflight = this.starting.get(pluginId)
    if (inflight) return inflight
    const p = this.spawn(pluginId).finally(() => this.starting.delete(pluginId))
    this.starting.set(pluginId, p)
    return p
  }

  private async spawn(pluginId: string): Promise<PluginProcess> {
    if (this.stopped) throw new Error('host is shutting down')
    const row = this.getRow(pluginId)
    if (!row) throw new Error('plugin not found')
    if (!row.enabled) throw new Error('plugin is disabled')

    const config = safeParseObj(row.config)
    const env: NodeJS.ProcessEnv = {}
    const allow = (JSON.parse(row.manifest) as { env?: string[] }).env ?? []
    for (const k of [...BASE_ENV_KEYS, ...allow]) {
      if (process.env[k] !== undefined) env[k] = process.env[k]
    }
    env.FW_PLUGIN_ID = row.id

    // Resolve to an absolute dir so the child (whose cwd we set to it) doesn't double-resolve.
    const installDir = resolve(row.installPath)
    const child = fork(this.runtimePath, [installDir], {
      cwd: installDir,
      env,
      execArgv: [], // don't inherit the dev loader (tsx) or other parent flags
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    })

    const permissions = new Set(JSON.parse(row.permissions) as PluginPermission[])
    const proc = new PluginProcess(child, this, row, permissions)
    this.procs.set(pluginId, proc)

    proc.send({
      t: 'init',
      plugin: { id: row.id, version: row.version, dataDir: installDir },
      mainPath: resolve(installDir, row.main),
      config,
    })

    // Bound the init handshake.
    const ready = await Promise.race([
      proc.ready.then(() => 'ready' as const),
      new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), READY_TIMEOUT_MS)),
    ]).catch((e) => {
      throw e
    })
    if (ready === 'timeout') {
      proc.kill()
      this.procs.delete(pluginId)
      this.setStatus(pluginId, 'error', 'plugin did not become ready in time')
      throw new Error('plugin did not become ready in time')
    }

    // Daemon plugins get an activation call and keep running.
    if (row.daemon) {
      await this.recordInvocation(row, 'activate', null, null, UI_TIMEOUT_MS * 4)
    }
    this.setStatus(pluginId, 'active', null)
    this.restarts.set(pluginId, 0)
    return proc
  }

  onProcessExit(pluginId: string, proc: PluginProcess, reason: string): void {
    if (this.procs.get(pluginId) === proc) this.procs.delete(pluginId)
    if (this.stopped || proc.killed) return
    const row = this.getRow(pluginId)
    if (!row || !row.enabled) return
    this.setStatus(pluginId, 'error', reason)
    // Auto-restart daemons (with a cap); on-demand plugins restart lazily on next use.
    if (row.daemon) {
      const n = (this.restarts.get(pluginId) ?? 0) + 1
      this.restarts.set(pluginId, n)
      if (n <= MAX_RESTARTS) {
        this.log.warn(`plugin ${pluginId} crashed (${reason}); restart ${n}/${MAX_RESTARTS}`)
        setTimeout(() => {
          if (!this.stopped) this.ensureStarted(pluginId).catch(() => {})
        }, 1000 * n).unref?.()
      } else {
        this.log.error(`plugin ${pluginId} crashed too many times; leaving stopped`)
      }
    }
  }

  /** Kill and forget a plugin's process (e.g. after a hung invoke). */
  recycle(pluginId: string): void {
    const proc = this.procs.get(pluginId)
    if (proc) {
      this.procs.delete(pluginId)
      proc.kill()
    }
  }

  /** Stop a plugin: best-effort deactivate, kill, and wait for the OS process to actually exit
   *  (so its install dir is no longer locked on Windows). */
  async stop(pluginId: string): Promise<void> {
    const proc = this.procs.get(pluginId)
    if (!proc) return
    this.procs.delete(pluginId)
    try {
      await Promise.race([proc.invoke('deactivate', null, 5000), delay(5000)])
    } catch {
      /* ignore */
    }
    proc.kill()
    await Promise.race([proc.exited, delay(5000)])
  }

  async restart(pluginId: string): Promise<void> {
    await this.stop(pluginId)
    await this.ensureStarted(pluginId)
  }

  updateConfig(pluginId: string, config: Record<string, unknown>): void {
    this.procs.get(pluginId)?.send({ t: 'config', config })
  }

  async stopAll(): Promise<void> {
    this.stopped = true
    const ids = [...this.procs.keys()]
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  // ---- Interactive panels (synchronous) ----
  async render(pluginId: string, panel: string, fields: Record<string, unknown>): Promise<UiView> {
    const proc = await this.ensureStarted(pluginId)
    const { value } = await proc.invoke('render', { panel, fields }, UI_TIMEOUT_MS)
    return this.validateView(value)
  }

  async action(pluginId: string, panel: string, payload: { action: string; value?: unknown; fields: Record<string, unknown> }): Promise<UiView> {
    const proc = await this.ensureStarted(pluginId)
    const { value } = await proc.invoke('action', { panel, ...payload }, UI_TIMEOUT_MS)
    return this.validateView(value)
  }

  private validateView(value: unknown): UiView {
    const parsed = uiViewSchema.safeParse(value)
    if (!parsed.success) throw new Error(`plugin returned an invalid UI view: ${parsed.error.issues[0]?.message ?? 'bad shape'}`)
    return parsed.data
  }

  // ---- Audited invocations (commands/events) — used by the job worker ----
  async runCommand(runId: string, pluginId: string, command: string, args: Record<string, unknown>, timeoutMs: number): Promise<void> {
    const row = this.getRow(pluginId)
    if (!row) return this.failRun(runId, 'plugin not found')
    await this.recordInvocation(row, 'command', { command, args }, runId, timeoutMs)
  }

  async dispatchEvent(runId: string, pluginId: string, event: string, payload: unknown, timeoutMs: number): Promise<void> {
    const row = this.getRow(pluginId)
    if (!row) return this.failRun(runId, 'plugin not found')
    await this.recordInvocation(row, 'event', { event, payload }, runId, timeoutMs)
  }

  /**
   * Run a lifecycle invocation (kind is the host->plugin invoke kind: command|event|activate),
   * recording its lifecycle in plugin_runs (when runId is supplied) and collecting the plugin's
   * logged output.
   */
  private async recordInvocation(
    row: PluginRow,
    kind: 'command' | 'event' | 'activate',
    payload: unknown,
    runId: string | null,
    timeoutMs: number,
  ): Promise<void> {
    const now = Date.now()
    if (runId) {
      this.db.update(pluginRuns).set({ status: 'running', startedAt: now }).where(eq(pluginRuns.id, runId)).run()
    }
    try {
      const proc = await this.ensureStarted(row.id)
      const { value, logs } = await proc.invoke(kind, payload, timeoutMs)
      const output = composeOutput(logs, value)
      if (runId) {
        this.db
          .update(pluginRuns)
          .set({ status: 'succeeded', output, finishedAt: Date.now() })
          .where(eq(pluginRuns.id, runId))
          .run()
      }
    } catch (e) {
      const err = e as Error & { timeout?: boolean; logs?: string }
      const status = err.timeout ? 'timeout' : 'failed'
      if (runId) {
        this.db
          .update(pluginRuns)
          .set({ status, output: err.logs ?? null, error: err.message, finishedAt: Date.now() })
          .where(eq(pluginRuns.id, runId))
          .run()
      }
      // The run row is the source of truth; we don't propagate so the worker job stays clean.
      this.log.warn(`plugin ${row.id} ${kind} failed: ${err.message}`)
    }
  }

  private failRun(runId: string, error: string): void {
    this.db.update(pluginRuns).set({ status: 'failed', error, finishedAt: Date.now() }).where(eq(pluginRuns.id, runId)).run()
  }

  private setStatus(pluginId: string, status: 'installed' | 'active' | 'error' | 'disabled', lastError: string | null): void {
    this.db.update(plugins).set({ status, lastError, updatedAt: Date.now() }).where(eq(plugins.id, pluginId)).run()
  }

  // ---- Host API dispatch (called by PluginProcess after the permission check) ----
  async dispatchApi(row: PluginRow, method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'media.list':
        return this.mediaList((params.query as MediaApiQuery) ?? {})
      case 'media.count':
        return { total: this.mediaWhereCount((params.query as MediaApiQuery) ?? {}) }
      case 'media.get':
        return this.mediaGet(String(params.id ?? ''))
      case 'repos.list':
        return { data: this.db.select().from(repositories).all().map((r) => ({ id: r.id, name: r.name, type: r.type, enabled: Boolean(r.enabled), readOnly: Boolean(r.readOnly), status: r.status, rootPath: r.rootPath })) }
      case 'categories.list': {
        const repoId = params.repositoryId ? String(params.repositoryId) : undefined
        const rows = repoId
          ? this.db.select().from(categories).where(eq(categories.repositoryId, repoId)).all()
          : this.db.select().from(categories).all()
        return { data: rows.map((c) => ({ id: c.id, name: c.name, path: c.path, depth: c.depth, itemCount: c.itemCount, repositoryId: c.repositoryId })) }
      }
      case 'collections.list': {
        const owner = row.installedBy
        const rows = owner ? this.db.select().from(collections).where(eq(collections.userId, owner)).all() : []
        return { data: rows.map((c) => ({ id: c.id, name: c.name, description: c.description })) }
      }
      case 'collections.create':
        return this.collectionsCreate(row, (params.input as { name?: string; description?: string }) ?? {})
      case 'collections.addItem':
        return this.collectionsAddItem(row, String(params.collectionId ?? ''), String(params.mediaItemId ?? ''))
      case 'clips.create':
        return this.clipsCreate(row, (params.input as ClipInput) ?? {})
      case 'storage.get':
        return this.storageGet(row.id, String(params.key ?? ''))
      case 'storage.set':
        return this.storageSet(row.id, String(params.key ?? ''), params.value)
      case 'storage.delete':
        this.db.delete(pluginKv).where(and(eq(pluginKv.pluginId, row.id), eq(pluginKv.key, String(params.key ?? '')))).run()
        return { ok: true }
      case 'storage.list': {
        const rows = this.db.select().from(pluginKv).where(eq(pluginKv.pluginId, row.id)).all()
        const out: Record<string, unknown> = {}
        for (const r of rows) out[r.key] = safeParse(r.value)
        return out
      }
      case 'notify': {
        const payload = (params.payload as Record<string, unknown>) ?? {}
        this.events.publish(`plugin:${row.id}`, { type: 'plugin.notify', pluginId: row.id, ...payload })
        this.log.info(`[plugin ${row.id}] notify: ${JSON.stringify(payload)}`)
        return { ok: true }
      }
      default:
        throw new Error(`unhandled host method: ${method}`)
    }
  }

  private mediaWhere(query: MediaApiQuery) {
    const conds = [eq(mediaItems.status, 'active')]
    if (query.type === 'video' || query.type === 'image') conds.push(eq(mediaItems.type, query.type))
    if (query.repository) conds.push(eq(mediaItems.repositoryId, String(query.repository)))
    return and(...conds)
  }

  private mediaWhereCount(query: MediaApiQuery): number {
    const row = this.db.select({ n: sql<number>`count(*)` }).from(mediaItems).where(this.mediaWhere(query)).get()
    return row?.n ?? 0
  }

  private mediaList(query: MediaApiQuery) {
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))
    const sortCol = query.sort === 'title' ? mediaItems.title : query.sort === 'duration' ? mediaItems.durationS : mediaItems.addedAt
    const dir = query.order === 'asc' ? asc : desc
    const rows = this.db.select().from(mediaItems).where(this.mediaWhere(query)).orderBy(dir(sortCol)).limit(limit).all()
    return { data: rows.map(toCard), total: this.mediaWhereCount(query) }
  }

  private mediaGet(id: string) {
    const m = this.db.select().from(mediaItems).where(eq(mediaItems.id, id)).get()
    return m ? toCard(m) : null
  }

  private collectionsCreate(row: PluginRow, input: { name?: string; description?: string }) {
    if (!row.installedBy) throw new Error('plugin installer is unknown; cannot own a collection')
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('collection name is required')
    const now = Date.now()
    const id = uuidv7()
    this.db
      .insert(collections)
      .values({ id, userId: row.installedBy, name, description: input.description ?? null, coverItemId: null, createdAt: now, updatedAt: now })
      .run()
    return { id, name }
  }

  private collectionsAddItem(row: PluginRow, collectionId: string, mediaItemId: string) {
    const col = this.db.select().from(collections).where(eq(collections.id, collectionId)).get()
    if (!col || col.userId !== row.installedBy) throw new Error('collection not found')
    if (!this.db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.id, mediaItemId)).get()) {
      throw new Error('media item not found')
    }
    const existing = this.db.select({ p: collectionItems.position }).from(collectionItems).where(eq(collectionItems.collectionId, collectionId)).all()
    const nextPos = existing.reduce((max, r) => Math.max(max, r.p + 1), 0)
    this.db
      .insert(collectionItems)
      .values({ collectionId, mediaItemId, position: nextPos, addedAt: Date.now() })
      .onConflictDoNothing()
      .run()
    return { ok: true }
  }

  private clipsCreate(row: PluginRow, input: ClipInput) {
    if (!row.installedBy) throw new Error('plugin installer is unknown; cannot own a clip')
    const src = this.db.select().from(mediaItems).where(eq(mediaItems.id, String(input.sourceItemId ?? ''))).get()
    if (!src || src.type !== 'video') throw new Error('source video not found')
    const startS = Number(input.startS) || 0
    const endS = Number(input.endS) || 0
    if (endS <= startS || endS - startS > MAX_CLIP_SECONDS) throw new Error('invalid clip range')
    const now = Date.now()
    const id = uuidv7()
    this.db
      .insert(clips)
      .values({
        id,
        userId: row.installedBy,
        sourceItemId: src.id,
        name: String(input.name ?? 'Clip').slice(0, 100),
        startS,
        endS,
        loop: input.loop === false ? 0 : 1,
        posterPath: null,
        exportPath: null,
        exportStatus: 'none',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return { id }
  }

  private storageGet(pluginId: string, key: string): unknown {
    const r = this.db.select().from(pluginKv).where(and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.key, key))).get()
    return r ? safeParse(r.value) : null
  }

  private storageSet(pluginId: string, key: string, value: unknown) {
    const json = JSON.stringify(value ?? null)
    const now = Date.now()
    this.db
      .insert(pluginKv)
      .values({ pluginId, key, value: json, updatedAt: now })
      .onConflictDoUpdate({ target: [pluginKv.pluginId, pluginKv.key], set: { value: json, updatedAt: now } })
      .run()
    return { ok: true }
  }
}

interface MediaApiQuery {
  type?: string
  repository?: string
  sort?: string
  order?: string
  limit?: number
}
interface ClipInput {
  sourceItemId?: string
  name?: string
  startS?: number
  endS?: number
  loop?: boolean
}

function toCard(m: typeof mediaItems.$inferSelect) {
  return {
    id: m.id,
    type: m.type,
    title: m.title,
    durationS: m.durationS,
    width: m.width,
    height: m.height,
    posterUrl: `/api/media/${m.id}/poster`,
    repositoryId: m.repositoryId,
    relPath: m.relPath,
    ext: m.ext,
    sizeBytes: m.sizeBytes,
    addedAt: m.addedAt,
  }
}

function composeOutput(logs: string, value: unknown): string {
  const parts: string[] = []
  if (logs) parts.push(logs)
  if (value !== null && value !== undefined) parts.push(`\n→ ${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`)
  return parts.join('\n').slice(0, MAX_LOG_BYTES)
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
function safeParseObj(s: string): Record<string, unknown> {
  const v = safeParse(s)
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
