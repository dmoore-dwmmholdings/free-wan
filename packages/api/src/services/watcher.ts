import { existsSync } from 'node:fs'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FastifyBaseLogger } from 'fastify'
import type { Db } from '../db/client'
import { repositories } from '../db/schema'

export interface WatcherOptions {
  enabled: boolean
  debounceMs: number
}

/**
 * Per-repository filesystem watcher (FR-13). A debounced change on a repo's tree
 * triggers `onChange(repoId)` — the app wires that to enqueue an incremental scan, so a
 * newly added file appears without a restart. Watching the whole tree + cheap
 * incremental scan is simpler and safer than per-event probing.
 */
export class WatcherManager {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly onChange: (repoId: string) => void,
    private readonly opts: WatcherOptions = { enabled: true, debounceMs: 1500 },
  ) {}

  /** Start watchers for enabled repos with a reachable root; stop watchers for the rest. */
  sync(): void {
    if (!this.opts.enabled) return
    const repos = this.db.select().from(repositories).all()
    const wanted = new Set<string>()
    for (const r of repos) {
      if (r.enabled && existsSync(r.rootPath)) {
        wanted.add(r.id)
        if (!this.watchers.has(r.id)) this.startOne(r.id, r.rootPath)
      }
    }
    for (const id of [...this.watchers.keys()]) {
      if (!wanted.has(id)) this.stopOne(id)
    }
  }

  /** Debounce a repo-level change into a single `onChange` after the quiet period. */
  schedule(repoId: string): void {
    const prev = this.timers.get(repoId)
    if (prev) clearTimeout(prev)
    this.timers.set(
      repoId,
      setTimeout(() => {
        this.timers.delete(repoId)
        this.onChange(repoId)
      }, this.opts.debounceMs),
    )
  }

  private startOne(repoId: string, root: string): void {
    const w = chokidar.watch(root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    })
    const onEvent = () => this.schedule(repoId)
    w.on('add', onEvent)
      .on('change', onEvent)
      .on('unlink', onEvent)
      .on('addDir', onEvent)
      .on('unlinkDir', onEvent)
      .on('error', (e) => this.log.warn(`watcher error for ${repoId}: ${String(e)}`))
    this.watchers.set(repoId, w)
    this.log.info(`watching repository ${repoId} at ${root}`)
  }

  private stopOne(repoId: string): void {
    const t = this.timers.get(repoId)
    if (t) {
      clearTimeout(t)
      this.timers.delete(repoId)
    }
    const w = this.watchers.get(repoId)
    if (w) {
      void w.close()
      this.watchers.delete(repoId)
    }
  }

  async stopAll(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    await Promise.all([...this.watchers.values()].map((w) => w.close()))
    this.watchers.clear()
  }

  watchedCount(): number {
    return this.watchers.size
  }
}
