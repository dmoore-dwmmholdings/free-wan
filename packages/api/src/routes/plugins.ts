import { desc, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import {
  installPluginRequestSchema,
  updatePluginRequestSchema,
  runPluginCommandRequestSchema,
  pluginActionRequestSchema,
  type AdminPluginDto,
  type PluginDto,
  type PluginManifest,
  type PluginRunDto,
} from '@free-wan/shared'
import { plugins, pluginRuns, type PluginRow, type PluginRunRow } from '../db/schema'
import {
  installFromDirectory,
  installFromZipFile,
  installFromZipBuffer,
  installFromUrl,
  removePluginFiles,
  PluginInstallError,
} from '../services/plugin-installer'
import { enqueueJob } from '../services/jobs'

const notFound = { error: { code: 'not_found', message: 'Plugin not found' } }
const validationError = { error: { code: 'validation_error', message: 'Invalid input' } }

function manifestOf(row: PluginRow): PluginManifest {
  return JSON.parse(row.manifest) as PluginManifest
}

function toUserDto(row: PluginRow, isAdmin: boolean): PluginDto {
  const m = manifestOf(row)
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    author: row.author,
    icon: row.icon,
    daemon: Boolean(row.daemon),
    enabled: Boolean(row.enabled),
    status: row.status,
    commands: m.commands.filter((c) => isAdmin || c.allowNonAdmin),
    panels: m.ui.filter((p) => isAdmin || p.allowNonAdmin),
  }
}

function toAdminDto(row: PluginRow): AdminPluginDto {
  const m = manifestOf(row)
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    author: row.author,
    icon: row.icon,
    daemon: Boolean(row.daemon),
    enabled: Boolean(row.enabled),
    status: row.status,
    commands: m.commands,
    panels: m.ui,
    manifest: m,
    permissions: m.permissions,
    events: m.events,
    config: safeObj(row.config),
    lastError: row.lastError,
    installedAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toRunDto(r: PluginRunRow): PluginRunDto {
  return {
    id: r.id,
    pluginId: r.pluginId,
    kind: r.kind,
    ref: r.ref,
    status: r.status,
    output: r.output,
    error: r.error,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  }
}

function safeObj(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Admin: install / manage plugins
// ---------------------------------------------------------------------------
export async function adminPluginRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAdmin)

  const disabledGuard = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!app.config.pluginsEnabled) {
      reply.code(503).send({ error: { code: 'unavailable', message: 'Plugins are disabled on this server' } })
      return reply
    }
  }

  app.get('/api/admin/plugins', async () => {
    const rows = app.db.select().from(plugins).orderBy(desc(plugins.createdAt)).all()
    return { data: rows.map(toAdminDto), registryUrl: app.config.pluginRegistryUrl ?? null, enabled: app.config.pluginsEnabled }
  })

  // Stop a running instance before its files are replaced (Windows locks a process's cwd).
  const stopForReplace = (id: string) => app.pluginHost.stop(id)
  // After an upgrade, bring the plugin back online if it was enabled.
  const restartIfEnabled = (id: string) => {
    const row = app.db.select().from(plugins).where(eq(plugins.id, id)).get()
    if (row?.enabled && app.config.pluginsEnabled) {
      app.pluginHost.ensureStarted(id).catch((e) => app.log.warn(`restart plugin ${id}: ${(e as Error).message}`))
    }
  }

  app.post('/api/admin/plugins/install', { preHandler: disabledGuard }, async (req, reply) => {
    try {
      let result
      // Multipart upload (a .zip file)…
      if (req.isMultipart()) {
        const file = await req.file()
        if (!file) return reply.code(422).send(validationError)
        const buf = await file.toBuffer()
        result = await installFromZipBuffer(app.db, app.config.dataDir, buf, req.user!.id, stopForReplace)
      } else {
        // …or a JSON body pointing at a server path or URL.
        const parsed = installPluginRequestSchema.safeParse(req.body)
        if (!parsed.success) return reply.code(422).send(validationError)
        result =
          parsed.data.source === 'url'
            ? await installFromUrl(app.db, app.config.dataDir, parsed.data.url, req.user!.id, stopForReplace)
            : await installFromServerPath(app, parsed.data.path, req.user!.id, stopForReplace)
      }
      if (result.replaced) restartIfEnabled(result.id)
      return reply.code(201).send(adminDtoById(app, result.id))
    } catch (e) {
      if (e instanceof PluginInstallError || (e as Error).message) {
        return reply.code(422).send({ error: { code: 'install_failed', message: (e as Error).message } })
      }
      throw e
    }
  })

  app.patch('/api/admin/plugins/:id', async (req, reply) => {
    const parsed = updatePluginRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    const row = app.db.select().from(plugins).where(eq(plugins.id, id)).get()
    if (!row) return reply.code(404).send(notFound)

    const patch: Partial<PluginRow> = { updatedAt: Date.now() }
    if (parsed.data.config !== undefined) {
      patch.config = JSON.stringify(parsed.data.config)
    }
    if (parsed.data.enabled !== undefined) {
      patch.enabled = parsed.data.enabled ? 1 : 0
      patch.status = parsed.data.enabled ? 'installed' : 'disabled'
      if (parsed.data.enabled) patch.lastError = null
    }
    app.db.update(plugins).set(patch).where(eq(plugins.id, id)).run()

    // Reflect the change in the running process.
    if (parsed.data.enabled === false) {
      await app.pluginHost.stop(id)
    } else if (parsed.data.enabled === true && app.config.pluginsEnabled) {
      app.pluginHost.ensureStarted(id).catch((e) => app.log.warn(`enable plugin ${id}: ${(e as Error).message}`))
    } else if (parsed.data.config !== undefined) {
      app.pluginHost.updateConfig(id, parsed.data.config)
    }
    return adminDtoById(app, id)
  })

  app.delete('/api/admin/plugins/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = app.db.select().from(plugins).where(eq(plugins.id, id)).get()
    if (!row) return reply.code(404).send(notFound)
    await app.pluginHost.stop(id)
    app.db.delete(plugins).where(eq(plugins.id, id)).run()
    removePluginFiles(row.installPath)
    return reply.code(204).send()
  })

  app.get('/api/admin/plugins/:id/runs', async (req) => {
    const { id } = req.params as { id: string }
    const rows = app.db.select().from(pluginRuns).where(eq(pluginRuns.pluginId, id)).orderBy(desc(pluginRuns.createdAt)).limit(100).all()
    return { data: rows.map(toRunDto) }
  })
}

// ---------------------------------------------------------------------------
// User: list / panels / commands / run history
// ---------------------------------------------------------------------------
export async function pluginRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  const enabledPlugin = (id: string): PluginRow | undefined => {
    if (!app.config.pluginsEnabled) return undefined
    const row = app.db.select().from(plugins).where(eq(plugins.id, id)).get()
    return row && row.enabled ? row : undefined
  }

  app.get('/api/plugins', async (req) => {
    if (!app.config.pluginsEnabled) return { data: [] }
    const isAdmin = req.user!.role === 'admin'
    const rows = app.db.select().from(plugins).where(eq(plugins.enabled, 1)).all()
    const visible = rows
      .map((r) => toUserDto(r, isAdmin))
      .filter((d) => isAdmin || d.commands.length > 0 || d.panels.length > 0)
    return { data: visible }
  })

  app.get('/api/plugins/:id/panels/:panel', async (req, reply) => {
    const { id, panel } = req.params as { id: string; panel: string }
    const row = enabledPlugin(id)
    if (!row) return reply.code(404).send(notFound)
    const def = manifestOf(row).ui.find((p) => p.id === panel)
    if (!def) return reply.code(404).send({ error: { code: 'not_found', message: 'Panel not found' } })
    if (req.user!.role !== 'admin' && !def.allowNonAdmin) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not permitted' } })
    }
    const q = req.query as Record<string, unknown>
    try {
      const view = await app.pluginHost.render(id, panel, q ?? {})
      return { view }
    } catch (e) {
      return reply.code(502).send({ error: { code: 'plugin_error', message: (e as Error).message } })
    }
  })

  app.post('/api/plugins/:id/panels/:panel/action', async (req, reply) => {
    const { id, panel } = req.params as { id: string; panel: string }
    const row = enabledPlugin(id)
    if (!row) return reply.code(404).send(notFound)
    const def = manifestOf(row).ui.find((p) => p.id === panel)
    if (!def) return reply.code(404).send({ error: { code: 'not_found', message: 'Panel not found' } })
    if (req.user!.role !== 'admin' && !def.allowNonAdmin) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not permitted' } })
    }
    const parsed = pluginActionRequestSchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(422).send(validationError)
    try {
      const view = await app.pluginHost.action(id, panel, parsed.data)
      return { view }
    } catch (e) {
      return reply.code(502).send({ error: { code: 'plugin_error', message: (e as Error).message } })
    }
  })

  app.post('/api/plugins/:id/commands/:command/run', async (req, reply) => {
    const { id, command } = req.params as { id: string; command: string }
    const row = enabledPlugin(id)
    if (!row) return reply.code(404).send(notFound)
    const def = manifestOf(row).commands.find((c) => c.id === command)
    if (!def) return reply.code(404).send({ error: { code: 'not_found', message: 'Command not found' } })
    if (req.user!.role !== 'admin' && !def.allowNonAdmin) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Not permitted' } })
    }
    const parsed = runPluginCommandRequestSchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(422).send(validationError)
    // Light required-field validation against the manifest.
    for (const p of def.params ?? []) {
      if (p.required && p.type !== 'boolean' && String(parsed.data.args[p.name] ?? '').trim() === '') {
        return reply.code(422).send({ error: { code: 'validation_error', message: `Missing required field: ${p.label}` } })
      }
    }

    const runId = uuidv7()
    app.db
      .insert(pluginRuns)
      .values({
        id: runId,
        pluginId: id,
        kind: 'command',
        ref: command,
        userId: req.user!.id,
        input: JSON.stringify(parsed.data.args).slice(0, 64 * 1024),
        status: 'queued',
        createdAt: Date.now(),
      })
      .run()
    enqueueJob(app.db, 'plugin_command', { runId, pluginId: id, command, args: parsed.data.args }, 5)
    app.worker.kick()
    return reply.code(202).send({ runId })
  })

  app.get('/api/plugins/:id/runs/:runId', async (req, reply) => {
    const { id, runId } = req.params as { id: string; runId: string }
    const r = app.db.select().from(pluginRuns).where(eq(pluginRuns.id, runId)).get()
    if (!r || r.pluginId !== id) return reply.code(404).send({ error: { code: 'not_found', message: 'Run not found' } })
    // Non-admins can only read their own command runs.
    if (req.user!.role !== 'admin' && r.userId !== req.user!.id) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Run not found' } })
    }
    return toRunDto(r)
  })
}

function adminDtoById(app: FastifyInstance, id: string): AdminPluginDto {
  return toAdminDto(app.db.select().from(plugins).where(eq(plugins.id, id)).get()!)
}

/** Install from a server-side directory or .zip path. */
async function installFromServerPath(app: FastifyInstance, path: string, userId: string, beforeReplace?: (id: string) => Promise<void> | void) {
  if (path.toLowerCase().endsWith('.zip')) {
    return installFromZipFile(app.db, app.config.dataDir, path, userId, beforeReplace)
  }
  return installFromDirectory(app.db, app.config.dataDir, path, userId, beforeReplace)
}
