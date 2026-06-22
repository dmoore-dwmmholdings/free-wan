import { eq, asc, desc } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { jobs, type JobRow } from '../db/schema'
import type { Db } from '../db/client'

export interface JobContext {
  db: Db
  jobId: string
  payload: unknown
  log: FastifyBaseLogger
  setProgress(p: number): void
}
export type JobHandler = (ctx: JobContext) => Promise<void>

/**
 * In-process job worker backed by the `jobs` table (architecture §3). Single-threaded
 * JS gives us cheap "atomic" claim semantics. `onIdle()` lets callers/tests await a drain.
 */
export class JobWorker {
  private readonly handlers = new Map<string, JobHandler>()
  private active = 0
  private idleWaiters: Array<() => void> = []
  private stopped = false

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly concurrency = 2,
  ) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler)
  }

  /** Schedule a drain on the next microtask (call after enqueueing). */
  kick(): void {
    queueMicrotask(() => this.pump())
  }

  stop(): void {
    this.stopped = true
  }

  onIdle(): Promise<void> {
    if (this.active === 0 && !this.hasQueued()) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private hasQueued(): boolean {
    return Boolean(
      this.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, 'queued')).limit(1).get(),
    )
  }

  private claimNext(): JobRow | undefined {
    const job = this.db
      .select()
      .from(jobs)
      .where(eq(jobs.status, 'queued'))
      .orderBy(desc(jobs.priority), asc(jobs.createdAt))
      .limit(1)
      .get()
    if (!job) return undefined
    const now = Date.now()
    this.db
      .update(jobs)
      .set({ status: 'running', startedAt: now, attempts: job.attempts + 1 })
      .where(eq(jobs.id, job.id))
      .run()
    return { ...job, status: 'running', startedAt: now, attempts: job.attempts + 1 }
  }

  private pump(): void {
    if (this.stopped) return
    while (this.active < this.concurrency) {
      const job = this.claimNext()
      if (!job) break
      this.active++
      void this.process(job).finally(() => {
        this.active--
        this.pump()
      })
    }
    if (this.active === 0 && !this.hasQueued()) this.resolveIdle()
  }

  private resolveIdle(): void {
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const w of waiters) w()
  }

  private async process(job: JobRow): Promise<void> {
    const handler = this.handlers.get(job.type)
    if (!handler) {
      this.fail(job.id, `no handler for job type "${job.type}"`)
      return
    }
    try {
      const payload: unknown = JSON.parse(job.payload)
      await handler({
        db: this.db,
        jobId: job.id,
        payload,
        log: this.log,
        setProgress: (p) => {
          this.db
            .update(jobs)
            .set({ progress: Math.max(0, Math.min(1, p)) })
            .where(eq(jobs.id, job.id))
            .run()
        },
      })
      this.db
        .update(jobs)
        .set({ status: 'succeeded', progress: 1, finishedAt: Date.now() })
        .where(eq(jobs.id, job.id))
        .run()
    } catch (e) {
      this.fail(job.id, e instanceof Error ? e.message : String(e))
      this.log.warn(`job ${job.id} (${job.type}) failed: ${String(e)}`)
    }
  }

  private fail(jobId: string, error: string): void {
    this.db
      .update(jobs)
      .set({ status: 'failed', error, finishedAt: Date.now() })
      .where(eq(jobs.id, jobId))
      .run()
  }
}
