import { and, eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import {
  createTagRequestSchema,
  updateTagRequestSchema,
  addMediaTagRequestSchema,
  type Tag,
  type TagWithCount,
} from '@free-wan/shared'
import { tags, mediaTags, mediaItems, type TagRow } from '../db/schema'

const notFound = { error: { code: 'not_found', message: 'Tag not found' } }
const invalid = { error: { code: 'validation_error', message: 'Invalid input' } }

function toDto(t: TagRow): Tag {
  return { id: t.id, name: t.name, color: t.color }
}

/** Find a tag by case-insensitive name (so "Beach" and "beach" don't both get created). */
function findByName(app: FastifyInstance, name: string): TagRow | undefined {
  return app.db
    .select()
    .from(tags)
    .where(sql`lower(${tags.name}) = ${name.toLowerCase()}`)
    .get()
}

/** Get-or-create a tag by name; returns the row. */
function ensureTag(app: FastifyInstance, name: string, color: string | null): TagRow {
  const existing = findByName(app, name)
  if (existing) return existing
  const row: TagRow = { id: uuidv7(), name, color, createdAt: Date.now() }
  app.db.insert(tags).values(row).run()
  return row
}

/** A media item's tags, ordered by name. Shared shape with the media-detail endpoint. */
export function tagsForItem(app: FastifyInstance, mediaItemId: string): Tag[] {
  return app.db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(mediaTags)
    .innerJoin(tags, eq(tags.id, mediaTags.tagId))
    .where(eq(mediaTags.mediaItemId, mediaItemId))
    .orderBy(tags.name)
    .all()
}

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  // All tags with how many items carry each (for the filter bar / picker).
  app.get('/api/tags', async () => {
    const rows = app.db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        itemCount: sql<number>`(SELECT COUNT(*) FROM media_tags WHERE media_tags.tag_id = ${tags.id})`,
      })
      .from(tags)
      .orderBy(tags.name)
      .all()
    const data: TagWithCount[] = rows.map((r) => ({ id: r.id, name: r.name, color: r.color, itemCount: Number(r.itemCount) }))
    return { data }
  })

  // Create a tag (idempotent by name — returns the existing one if the name is taken).
  app.post('/api/tags', async (req, reply) => {
    const parsed = createTagRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(invalid)
    const name = parsed.data.name.trim()
    const existing = findByName(app, name)
    if (existing) return reply.code(200).send(toDto(existing))
    const row: TagRow = { id: uuidv7(), name, color: parsed.data.color ?? null, createdAt: Date.now() }
    app.db.insert(tags).values(row).run()
    return reply.code(201).send(toDto(row))
  })

  app.patch('/api/tags/:id', async (req, reply) => {
    const parsed = updateTagRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(invalid)
    const { id } = req.params as { id: string }
    const tag = app.db.select().from(tags).where(eq(tags.id, id)).get()
    if (!tag) return reply.code(404).send(notFound)
    const d = parsed.data
    if (d.name !== undefined) {
      const clash = findByName(app, d.name.trim())
      if (clash && clash.id !== id) {
        return reply.code(409).send({ error: { code: 'conflict', message: 'A tag with that name already exists' } })
      }
    }
    const patch: Partial<TagRow> = {}
    if (d.name !== undefined) patch.name = d.name.trim()
    if (d.color !== undefined) patch.color = d.color ?? null
    app.db.update(tags).set(patch).where(eq(tags.id, id)).run()
    return toDto(app.db.select().from(tags).where(eq(tags.id, id)).get()!)
  })

  app.delete('/api/tags/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!app.db.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).get()) {
      return reply.code(404).send(notFound)
    }
    app.db.delete(tags).where(eq(tags.id, id)).run() // media_tags rows cascade away
    return reply.code(204).send()
  })

  // Attach a tag to a media item (by id, or by name — created on the fly). Returns the item's tags.
  app.post('/api/media/:id/tags', async (req, reply) => {
    const parsed = addMediaTagRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(invalid)
    const { id } = req.params as { id: string }
    if (!app.db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.id, id)).get()) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Media not found' } })
    }
    const d = parsed.data
    let tag: TagRow | undefined
    if (d.tagId) {
      tag = app.db.select().from(tags).where(eq(tags.id, d.tagId)).get()
      if (!tag) return reply.code(404).send(notFound)
    } else {
      tag = ensureTag(app, d.name!.trim(), d.color ?? null)
    }
    app.db
      .insert(mediaTags)
      .values({ mediaItemId: id, tagId: tag.id, createdAt: Date.now() })
      .onConflictDoNothing()
      .run()
    return reply.code(201).send({ data: tagsForItem(app, id) })
  })

  app.delete('/api/media/:id/tags/:tagId', async (req, reply) => {
    const { id, tagId } = req.params as { id: string; tagId: string }
    app.db.delete(mediaTags).where(and(eq(mediaTags.mediaItemId, id), eq(mediaTags.tagId, tagId))).run()
    return reply.code(204).send()
  })
}
