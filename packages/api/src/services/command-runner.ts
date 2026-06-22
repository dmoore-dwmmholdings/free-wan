import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Db } from '../db/client'
import { commandRuns } from '../db/schema'
import type { EventHub } from './events'

export interface RunSpec {
  runId: string
  executable: string
  argv: string[]
  cwd: string
  /** Minimal, allowlisted environment — secrets are NOT inherited (security §5). */
  env: NodeJS.ProcessEnv
  timeoutS: number
  maxOutputKb: number
}

interface Active {
  child: ChildProcessWithoutNullStreams
  killReason?: 'canceled' | 'timeout'
}

const KILL_GRACE_MS = 3000

/**
 * Executes a command in a sandbox (security §5): `spawn` with **no shell**, a clean
 * allowlisted env, a confined cwd, a hard timeout (SIGTERM→SIGKILL), an output cap, and
 * cancellation. Streams output to the EventHub `run:{runId}` topic and persists the result.
 */
export class CommandRunner {
  private readonly running = new Map<string, Active>()

  constructor(
    private readonly db: Db,
    private readonly events: EventHub,
    private readonly log: FastifyBaseLogger,
  ) {}

  async run(spec: RunSpec): Promise<void> {
    const { runId } = spec
    const startedAt = Date.now()
    this.db.update(commandRuns).set({ status: 'running', startedAt }).where(eq(commandRuns.id, runId)).run()
    this.events.publish(`run:${runId}`, { type: 'run.status', runId, status: 'running' })

    const child = spawn(spec.executable, spec.argv, {
      shell: false,
      cwd: spec.cwd,
      env: spec.env,
      detached: process.platform !== 'win32', // own process group → group-kill on POSIX
    })
    const active: Active = { child }
    this.running.set(runId, active)

    const cap = spec.maxOutputKb * 1024
    let output = ''
    let bytes = 0
    let truncated = false
    const onChunk = (stream: 'stdout' | 'stderr') => (d: Buffer) => {
      const text = d.toString()
      this.events.publish(`run:${runId}`, { type: 'run.output', runId, stream, chunk: text })
      if (truncated) return
      const room = cap - bytes
      if (room > 0) output += text.slice(0, room)
      bytes += d.length
      if (bytes >= cap) truncated = true
    }
    child.stdout.on('data', onChunk('stdout'))
    child.stderr.on('data', onChunk('stderr'))

    const timer = setTimeout(() => {
      active.killReason = 'timeout'
      this.killChild(child)
    }, spec.timeoutS * 1000)

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('error', (e) => {
        output += `\n[spawn error] ${String(e)}`
        resolve(null)
      })
      child.on('close', (code) => resolve(code))
    })
    clearTimeout(timer)
    this.running.delete(runId)

    const status =
      active.killReason === 'timeout'
        ? 'timeout'
        : active.killReason === 'canceled'
          ? 'canceled'
          : exitCode === 0
            ? 'succeeded'
            : 'failed'
    const finishedAt = Date.now()
    this.db
      .update(commandRuns)
      .set({ status, exitCode, outputText: output, truncated: truncated ? 1 : 0, finishedAt })
      .where(eq(commandRuns.id, runId))
      .run()
    this.events.publish(`run:${runId}`, {
      type: 'run.status',
      runId,
      status,
      exitCode,
      durationMs: finishedAt - startedAt,
    })
  }

  /** Request cancellation of a running command; returns false if it isn't running. */
  cancel(runId: string): boolean {
    const active = this.running.get(runId)
    if (!active) return false
    active.killReason = 'canceled'
    this.killChild(active.child)
    return true
  }

  isRunning(runId: string): boolean {
    return this.running.has(runId)
  }

  private killChild(child: ChildProcessWithoutNullStreams): void {
    const pid = child.pid
    const sig = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && pid) {
          try {
            process.kill(-pid, signal) // kill the whole process group
          } catch {
            child.kill(signal)
          }
        } else {
          child.kill(signal)
        }
      } catch {
        /* already gone */
      }
    }
    sig('SIGTERM')
    setTimeout(() => sig('SIGKILL'), KILL_GRACE_MS).unref?.()
  }

  stopAll(): void {
    for (const a of this.running.values()) this.killChild(a.child)
    this.running.clear()
  }
}
