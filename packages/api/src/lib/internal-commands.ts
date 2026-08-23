import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import { commandRuns, commands, mediaItems, repositories, type CommandRow, type CommandRunRow } from '../db/schema'
import { enqueueJob } from '../services/jobs'

/**
 * Built-in maintenance commands (Phase 9 deferral, FR-57): they appear on the Commands
 * page like any other command but run in-process — no spawn, no shell, `internal:`
 * executables can never be created through the admin API because they are not in the
 * `COMMAND_ALLOWED_EXECUTABLES` allowlist.
 */
const DEFINITIONS = [
  {
    executable: 'internal:rescan',
    name: 'Rescan all libraries',
    description: 'Queue an incremental scan of every enabled library.',
  },
  {
    executable: 'internal:rebuild-thumbnails',
    name: 'Rebuild missing thumbnails',
    description: 'Queue poster generation for indexed items that have none.',
  },
  {
    executable: 'internal:clear-transcode-cache',
    name: 'Clear transcode cache',
    description: 'Delete all cached video transcodes. They re-render on the next watch.',
  },
] as const

/** Create any missing built-ins (idempotent; admin toggles like enabled are preserved). */
export function seedInternalCommands(app: FastifyInstance): void {
  for (const d of DEFINITIONS) {
    const existing = app.db.select({ id: commands.id }).from(commands).where(eq(commands.executable, d.executable)).get()
    if (existing) continue
    const now = Date.now()
    app.db
      .insert(commands)
      .values({
        id: uuidv7(),
        name: d.name,
        description: d.description,
        executable: d.executable,
        argTemplate: '[]',
        workingDir: null,
        timeoutS: 600,
        maxOutputKb: 64,
        envAllowlist: '[]',
        allowNonAdmin: 0,
        enabled: 1,
        isInternal: 1,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }
}

/** Execute an internal command's run in-process, recording status/output like a spawn. */
export async function runInternalCommand(app: FastifyInstance, run: CommandRunRow, cmd: CommandRow): Promise<void> {
  app.db.update(commandRuns).set({ status: 'running', startedAt: Date.now() }).where(eq(commandRuns.id, run.id)).run()
  try {
    const output = execute(app, cmd.executable)
    app.db
      .update(commandRuns)
      .set({ status: 'succeeded', exitCode: 0, outputText: output, finishedAt: Date.now() })
      .where(eq(commandRuns.id, run.id))
      .run()
    app.events.publish(`run:${run.id}`, { type: 'run.status', runId: run.id, status: 'succeeded', exitCode: 0 })
  } catch (e) {
    app.db
      .update(commandRuns)
      .set({ status: 'failed', exitCode: 1, outputText: `${(e as Error).message}\n`, finishedAt: Date.now() })
      .where(eq(commandRuns.id, run.id))
      .run()
    app.events.publish(`run:${run.id}`, { type: 'run.status', runId: run.id, status: 'failed', exitCode: 1 })
  }
}

function execute(app: FastifyInstance, executable: string): string {
  switch (executable) {
    case 'internal:rescan': {
      const repos = app.db.select().from(repositories).where(eq(repositories.enabled, 1)).all()
      for (const r of repos) enqueueJob(app.db, 'scan', { repositoryId: r.id, full: false }, 10)
      if (repos.length > 0) app.worker.kick()
      const lines = repos.map((r) => ` - ${r.name}`).join('\n')
      return `Queued incremental scans for ${repos.length} librar${repos.length === 1 ? 'y' : 'ies'}.\n${lines}\n`
    }
    case 'internal:rebuild-thumbnails': {
      const missing = app.db
        .select({ id: mediaItems.id })
        .from(mediaItems)
        .where(and(eq(mediaItems.status, 'active'), isNull(mediaItems.posterPath)))
        .all()
      for (const m of missing) enqueueJob(app.db, 'thumbnail', { mediaItemId: m.id }, 3)
      if (missing.length > 0) app.worker.kick()
      return `Queued poster generation for ${missing.length} item(s) without one.\n`
    }
    case 'internal:clear-transcode-cache': {
      const hlsDir = join(app.config.dataDir, 'hls')
      let removed = 0
      if (existsSync(hlsDir)) {
        for (const entry of readdirSync(hlsDir)) {
          rmSync(join(hlsDir, entry), { recursive: true, force: true })
          removed++
        }
      }
      return `Cleared ${removed} cached transcode(s).\n`
    }
    default:
      throw new Error(`Unknown internal command: ${executable}`)
  }
}
