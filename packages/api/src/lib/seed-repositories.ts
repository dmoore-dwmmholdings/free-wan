import { existsSync, readFileSync, statSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { repositoryTypeSchema } from '@free-wan/shared'
import { appMeta, repositories } from '../db/schema'
import { enqueueJob } from '../services/jobs'

const SEEDED_META_KEY = 'repositories_seeded'

const seedFileSchema = z.object({
  repositories: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        path: z.string().min(1),
        type: repositoryTypeSchema.default('mixed'),
        readOnly: z.boolean().default(true),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
})

/**
 * First-run repository seeding (FR-02): create the repositories listed in
 * `config/repositories.yaml` and queue an initial scan for each. Runs exactly once per
 * data dir — an `app_meta` flag records the attempt, so repositories deleted in the admin
 * UI are never resurrected by a restart (the file is a bootstrap convenience, not a
 * reconciled source of truth). A non-empty repositories table also counts as "already
 * set up" (covers data dirs created before this feature existed).
 */
export function seedRepositories(app: FastifyInstance): void {
  const already = app.db.select().from(appMeta).where(eq(appMeta.key, SEEDED_META_KEY)).get()
  if (already) return
  const existing = app.db.select({ id: repositories.id }).from(repositories).limit(1).get()
  if (existing) return
  // Mark the attempt up front: a bad file logs a warning once, not on every boot.
  app.db.insert(appMeta).values({ key: SEEDED_META_KEY, value: '1' }).run()

  const file = app.config.repositoriesFile
  if (!file || !existsSync(file)) return

  let doc: unknown
  try {
    doc = parse(readFileSync(file, 'utf8'))
  } catch (e) {
    app.log.warn(`Cannot parse ${file}: ${(e as Error).message} — no repositories seeded`)
    return
  }
  if (doc == null) return // empty file
  const parsed = seedFileSchema.safeParse(doc)
  if (!parsed.success) {
    app.log.warn(`Invalid ${file}: ${parsed.error.issues[0]?.message ?? 'schema mismatch'} — no repositories seeded`)
    return
  }

  let seeded = 0
  for (const entry of parsed.data.repositories) {
    if (!existsSync(entry.path) || !statSync(entry.path).isDirectory()) {
      app.log.warn(`Skipping seeded repository "${entry.name}": ${entry.path} does not exist or is not a directory`)
      continue
    }
    const now = Date.now()
    const id = uuidv7()
    app.db
      .insert(repositories)
      .values({
        id,
        name: entry.name,
        rootPath: entry.path,
        type: entry.type,
        enabled: entry.enabled ? 1 : 0,
        readOnly: entry.readOnly ? 1 : 0,
        status: 'unknown',
        lastScanAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    if (entry.enabled) enqueueJob(app.db, 'scan', { repositoryId: id, full: false }, 10)
    seeded++
  }
  if (seeded > 0) {
    app.log.info(`Seeded ${seeded} repositor${seeded === 1 ? 'y' : 'ies'} from ${file}`)
    app.worker.kick()
  }
}
