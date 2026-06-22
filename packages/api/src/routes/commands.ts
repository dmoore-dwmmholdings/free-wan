import { statSync } from 'node:fs'
import { and, eq, desc } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import {
  createCommandRequestSchema,
  updateCommandRequestSchema,
  runCommandRequestSchema,
  type CommandDto,
  type CommandParamInput,
  type CommandRunDto,
} from '@free-wan/shared'
import {
  commands,
  commandParams,
  commandRuns,
  repositories,
  type CommandRow,
  type CommandRunRow,
} from '../db/schema'
import { resolveWithinRoot } from '../lib/path-safety'
import { buildArgv } from '../lib/argv-builder'
import { validateCommandArgs, type RepoPathResolver } from '../lib/validate-command-args'
import { enqueueJob } from '../services/jobs'

const validationError = { error: { code: 'validation_error', message: 'Invalid input' } }
const notFound = { error: { code: 'not_found', message: 'Command not found' } }

function paramsOf(app: FastifyInstance, commandId: string): CommandParamInput[] {
  return app.db
    .select()
    .from(commandParams)
    .where(eq(commandParams.commandId, commandId))
    .orderBy(commandParams.position)
    .all()
    .map((p) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      required: Boolean(p.required),
      default: p.defaultValue,
      constraints: p.constraints ? JSON.parse(p.constraints) : undefined,
    }))
}

function toDto(app: FastifyInstance, c: CommandRow): CommandDto {
  const rows = app.db.select().from(commandParams).where(eq(commandParams.commandId, c.id)).orderBy(commandParams.position).all()
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    allowNonAdmin: Boolean(c.allowNonAdmin),
    enabled: Boolean(c.enabled),
    isInternal: Boolean(c.isInternal),
    params: rows.map((p) => ({
      id: p.id,
      name: p.name,
      label: p.label,
      type: p.type,
      required: Boolean(p.required),
      default: p.defaultValue,
      constraints: p.constraints ? JSON.parse(p.constraints) : undefined,
      position: p.position,
    })),
  }
}

function toRunDto(r: CommandRunRow): CommandRunDto {
  return {
    id: r.id,
    commandId: r.commandId,
    status: r.status,
    exitCode: r.exitCode,
    resolvedArgv: JSON.parse(r.resolvedArgv) as string[],
    output: r.outputText,
    truncated: Boolean(r.truncated),
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  }
}

function insertParams(app: FastifyInstance, commandId: string, params: CommandParamInput[]): void {
  params.forEach((p, i) => {
    app.db
      .insert(commandParams)
      .values({
        id: uuidv7(),
        commandId,
        name: p.name,
        label: p.label,
        type: p.type,
        required: p.required ? 1 : 0,
        defaultValue: p.default ?? null,
        constraints: p.constraints ? JSON.stringify(p.constraints) : null,
        position: i,
      })
      .run()
  })
}

// ---- admin: define commands ----
export async function adminCommandRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAdmin)

  app.get('/api/admin/commands', async () => {
    const rows = app.db.select().from(commands).all()
    return { data: rows.map((c) => toDto(app, c)) }
  })

  app.post('/api/admin/commands', async (req, reply) => {
    const parsed = createCommandRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const d = parsed.data
    // The executable can never be introduced by form input and must be allowlisted.
    if (!app.config.commandAllowedExecutables.includes(d.executable)) {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'executable is not allowlisted' } })
    }
    const now = Date.now()
    const id = uuidv7()
    app.db
      .insert(commands)
      .values({
        id,
        name: d.name,
        description: d.description ?? null,
        executable: d.executable,
        argTemplate: JSON.stringify(d.argTemplate),
        workingDir: d.workingDir ?? null,
        timeoutS: d.timeoutS ?? 600,
        maxOutputKb: d.maxOutputKb ?? 1024,
        envAllowlist: JSON.stringify(d.envAllowlist ?? []),
        allowNonAdmin: d.allowNonAdmin ? 1 : 0,
        enabled: d.enabled === false ? 0 : 1,
        isInternal: 0,
        createdBy: req.user!.id,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    insertParams(app, id, d.params)
    return reply.code(201).send(toDto(app, app.db.select().from(commands).where(eq(commands.id, id)).get()!))
  })

  app.patch('/api/admin/commands/:id', async (req, reply) => {
    const parsed = updateCommandRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    const cmd = app.db.select().from(commands).where(eq(commands.id, id)).get()
    if (!cmd) return reply.code(404).send(notFound)
    const d = parsed.data
    if (d.executable !== undefined && !app.config.commandAllowedExecutables.includes(d.executable)) {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'executable is not allowlisted' } })
    }
    const patch: Partial<CommandRow> = { updatedAt: Date.now() }
    if (d.name !== undefined) patch.name = d.name
    if (d.description !== undefined) patch.description = d.description ?? null
    if (d.executable !== undefined) patch.executable = d.executable
    if (d.argTemplate !== undefined) patch.argTemplate = JSON.stringify(d.argTemplate)
    if (d.workingDir !== undefined) patch.workingDir = d.workingDir ?? null
    if (d.timeoutS !== undefined) patch.timeoutS = d.timeoutS
    if (d.maxOutputKb !== undefined) patch.maxOutputKb = d.maxOutputKb
    if (d.envAllowlist !== undefined) patch.envAllowlist = JSON.stringify(d.envAllowlist)
    if (d.allowNonAdmin !== undefined) patch.allowNonAdmin = d.allowNonAdmin ? 1 : 0
    if (d.enabled !== undefined) patch.enabled = d.enabled ? 1 : 0
    app.db.update(commands).set(patch).where(eq(commands.id, id)).run()
    if (d.params !== undefined) {
      app.db.delete(commandParams).where(eq(commandParams.commandId, id)).run()
      insertParams(app, id, d.params)
    }
    return toDto(app, app.db.select().from(commands).where(eq(commands.id, id)).get()!)
  })

  app.delete('/api/admin/commands/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!app.db.select({ id: commands.id }).from(commands).where(eq(commands.id, id)).get()) {
      return reply.code(404).send(notFound)
    }
    app.db.delete(commands).where(eq(commands.id, id)).run()
    return reply.code(204).send()
  })
}

// ---- user: list / run / history ----
export async function commandRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  const canRun = (c: CommandRow, role: string, canRunCommands: boolean) =>
    Boolean(c.enabled) && (role === 'admin' || (Boolean(c.allowNonAdmin) && canRunCommands))

  app.get('/api/commands', async (req) => {
    const u = req.user!
    const rows = app.db.select().from(commands).all().filter((c) => canRun(c, u.role, u.canRunCommands))
    return { data: rows.map((c) => toDto(app, c)) }
  })

  app.post('/api/commands/:id/run', async (req, reply) => {
    const parsed = runCommandRequestSchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    const cmd = app.db.select().from(commands).where(eq(commands.id, id)).get()
    if (!cmd) return reply.code(404).send(notFound)
    if (!canRun(cmd, req.user!.role, req.user!.canRunCommands)) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not permitted to run this command' } })
    }

    const resolveRepoPath: RepoPathResolver = (repoId, value, mustBeDir) => {
      const repo = repoId ? app.db.select().from(repositories).where(eq(repositories.id, repoId)).get() : undefined
      if (!repo) throw new Error('unknown repository')
      const abs = resolveWithinRoot(repo.rootPath, value)
      if (mustBeDir && !statSync(abs).isDirectory()) throw new Error('not a directory')
      return abs
    }

    const { ok, values, errors } = validateCommandArgs(paramsOf(app, id), parsed.data.args, resolveRepoPath)
    if (!ok) {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'Invalid arguments', details: errors } })
    }
    const argv = buildArgv(JSON.parse(cmd.argTemplate), values)

    const runId = uuidv7()
    app.db
      .insert(commandRuns)
      .values({
        id: runId,
        commandId: id,
        userId: req.user!.id,
        args: JSON.stringify(parsed.data.args),
        resolvedArgv: JSON.stringify(argv),
        status: 'queued',
        truncated: 0,
        createdAt: Date.now(),
      })
      .run()
    enqueueJob(app.db, 'command_run', { runId }, 5)
    app.worker.kick()
    return reply.code(202).send({ runId })
  })

  app.get('/api/command-runs', async (req) => {
    const q = req.query as { commandId?: string; mine?: string }
    const isAdmin = req.user!.role === 'admin'
    const all = app.db.select().from(commandRuns).orderBy(desc(commandRuns.createdAt)).all()
    const filtered = all.filter((r) => {
      if (q.commandId && r.commandId !== q.commandId) return false
      if (!isAdmin || q.mine === 'true') return r.userId === req.user!.id
      return true
    })
    return { data: filtered.map(toRunDto) }
  })

  const ownedRun = (app2: FastifyInstance, id: string, userId: string, isAdmin: boolean): CommandRunRow | undefined => {
    const r = app2.db.select().from(commandRuns).where(eq(commandRuns.id, id)).get()
    if (!r) return undefined
    if (!isAdmin && r.userId !== userId) return undefined
    return r
  }

  app.get('/api/command-runs/:id', async (req, reply) => {
    const r = ownedRun(app, (req.params as { id: string }).id, req.user!.id, req.user!.role === 'admin')
    if (!r) return reply.code(404).send({ error: { code: 'not_found', message: 'Run not found' } })
    return toRunDto(r)
  })

  app.post('/api/command-runs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string }
    const r = ownedRun(app, id, req.user!.id, req.user!.role === 'admin')
    if (!r) return reply.code(404).send({ error: { code: 'not_found', message: 'Run not found' } })
    if (!app.commandRunner.cancel(id) && r.status === 'queued') {
      app.db.update(commandRuns).set({ status: 'canceled', finishedAt: Date.now() }).where(eq(commandRuns.id, id)).run()
    }
    return reply.code(202).send({ ok: true })
  })
}
