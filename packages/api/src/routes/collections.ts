import { and, eq, count, max } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import type { FastifyInstance } from 'fastify'
import {
  createCollectionRequestSchema,
  updateCollectionRequestSchema,
  addCollectionItemRequestSchema,
  reorderCollectionRequestSchema,
  type CollectionDto,
} from '@free-wan/shared'
import { collections, collectionItems, mediaItems, type CollectionRow } from '../db/schema'

const validationError = { error: { code: 'validation_error', message: 'Invalid input' } }
const notFound = { error: { code: 'not_found', message: 'Collection not found' } }

function toDto(app: FastifyInstance, c: CollectionRow): CollectionDto {
  const itemCount =
    app.db.select({ n: count() }).from(collectionItems).where(eq(collectionItems.collectionId, c.id)).get()?.n ?? 0
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    coverItemId: c.coverItemId,
    coverUrl: c.coverItemId ? `/api/media/${c.coverItemId}/poster` : null,
    itemCount,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

/** Load a collection owned by the caller, or null (used to enforce per-user isolation). */
function owned(app: FastifyInstance, id: string, userId: string): CollectionRow | undefined {
  return app.db
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, userId)))
    .get()
}

export async function collectionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  app.get('/api/collections', async (req) => {
    const rows = app.db
      .select()
      .from(collections)
      .where(eq(collections.userId, req.user!.id))
      .all()
    return { data: rows.map((c) => toDto(app, c)) }
  })

  app.post('/api/collections', async (req, reply) => {
    const parsed = createCollectionRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const now = Date.now()
    const id = uuidv7()
    app.db
      .insert(collections)
      .values({
        id,
        userId: req.user!.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        coverItemId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return reply.code(201).send(toDto(app, owned(app, id, req.user!.id)!))
  })

  app.patch('/api/collections/:id', async (req, reply) => {
    const parsed = updateCollectionRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    const c = owned(app, id, req.user!.id)
    if (!c) return reply.code(404).send(notFound)

    const patch: Partial<CollectionRow> = { updatedAt: Date.now() }
    if (parsed.data.name !== undefined) patch.name = parsed.data.name
    if (parsed.data.description !== undefined) patch.description = parsed.data.description
    if (parsed.data.coverItemId !== undefined) patch.coverItemId = parsed.data.coverItemId
    app.db.update(collections).set(patch).where(eq(collections.id, id)).run()
    return reply.send(toDto(app, owned(app, id, req.user!.id)!))
  })

  app.delete('/api/collections/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!owned(app, id, req.user!.id)) return reply.code(404).send(notFound)
    app.db.delete(collections).where(eq(collections.id, id)).run()
    return reply.code(204).send()
  })

  app.post('/api/collections/:id/items', async (req, reply) => {
    const parsed = addCollectionItemRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    if (!owned(app, id, req.user!.id)) return reply.code(404).send(notFound)
    const item = app.db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.id, parsed.data.mediaItemId)).get()
    if (!item) return reply.code(404).send({ error: { code: 'not_found', message: 'Media not found' } })

    const nextPos =
      parsed.data.position ??
      (app.db.select({ m: max(collectionItems.position) }).from(collectionItems).where(eq(collectionItems.collectionId, id)).get()?.m ?? -1) + 1
    app.db
      .insert(collectionItems)
      .values({ collectionId: id, mediaItemId: parsed.data.mediaItemId, position: nextPos, addedAt: Date.now() })
      .onConflictDoNothing()
      .run()
    app.db.update(collections).set({ updatedAt: Date.now() }).where(eq(collections.id, id)).run()
    return reply.code(204).send()
  })

  app.patch('/api/collections/:id/items', async (req, reply) => {
    const parsed = reorderCollectionRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send(validationError)
    const { id } = req.params as { id: string }
    if (!owned(app, id, req.user!.id)) return reply.code(404).send(notFound)
    parsed.data.order.forEach((mediaItemId, i) => {
      app.db
        .update(collectionItems)
        .set({ position: i })
        .where(and(eq(collectionItems.collectionId, id), eq(collectionItems.mediaItemId, mediaItemId)))
        .run()
    })
    app.db.update(collections).set({ updatedAt: Date.now() }).where(eq(collections.id, id)).run()
    return reply.code(204).send()
  })

  app.delete('/api/collections/:id/items/:mediaItemId', async (req, reply) => {
    const { id, mediaItemId } = req.params as { id: string; mediaItemId: string }
    if (!owned(app, id, req.user!.id)) return reply.code(404).send(notFound)
    app.db
      .delete(collectionItems)
      .where(and(eq(collectionItems.collectionId, id), eq(collectionItems.mediaItemId, mediaItemId)))
      .run()
    return reply.code(204).send()
  })
}
