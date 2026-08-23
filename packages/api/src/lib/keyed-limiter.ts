/**
 * Deduplicates concurrent work per key and caps how many tasks run at once.
 * Keeps request-triggered ffmpeg spawns (scrub frames, image variants) from piling
 * up: concurrent requests for the same output file join one task instead of each
 * spawning ffmpeg, and at most `maxConcurrent` tasks run across all keys.
 */
export class KeyedLimiter {
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private readonly waiters: Array<() => void> = []
  private running = 0

  constructor(private readonly maxConcurrent: number) {}

  /** True while a task for `key` is queued or running (its output must not be trusted yet). */
  isPending(key: string): boolean {
    return this.inFlight.has(key)
  }

  /** Join the in-flight task for `key`, or start one (queued behind the concurrency cap). */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) return existing as Promise<T>
    const p = this.exec(task).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, p)
    return p
  }

  private async exec<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
      // The releasing task handed its slot to us — `running` stays as-is.
    } else {
      this.running++
    }
    try {
      return await task()
    } finally {
      const next = this.waiters.shift()
      if (next) next()
      else this.running--
    }
  }
}
