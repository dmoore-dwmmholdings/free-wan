type Listener = (data: unknown) => void

/**
 * Minimal in-process pub/sub used to fan realtime events (scan progress, job/run
 * updates) out to subscribed WebSocket clients. Topic strings follow the API doc §13,
 * e.g. `scan:{repositoryId}`, `job:{jobId}`, `run:{runId}`.
 */
export class EventHub {
  private readonly topics = new Map<string, Set<Listener>>()

  subscribe(topic: string, fn: Listener): () => void {
    let set = this.topics.get(topic)
    if (!set) {
      set = new Set()
      this.topics.set(topic, set)
    }
    set.add(fn)
    return () => {
      const s = this.topics.get(topic)
      if (!s) return
      s.delete(fn)
      if (s.size === 0) this.topics.delete(topic)
    }
  }

  publish(topic: string, data: unknown): void {
    const set = this.topics.get(topic)
    if (!set) return
    for (const fn of set) {
      try {
        fn(data)
      } catch {
        /* a broken subscriber must not break the publisher */
      }
    }
  }

  subscriberCount(topic: string): number {
    return this.topics.get(topic)?.size ?? 0
  }
}
