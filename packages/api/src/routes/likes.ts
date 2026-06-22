import { and, eq, count } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { LikeResponse } from '@free-wan/shared'
import { likes, mediaItems } from '../db/schema'

function likeCountOf(app: FastifyInstance, mediaItemId: string): number {
  return app.db.select({ n: count() }).from(likes).where(eq(likes.mediaItemId, mediaItemId)).get()?.n ?? 0
}

export async function likeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  app.put('/api/media/:id/like', async (req, reply) => {
    const { id } = req.params as { id: string }
    const item = app.db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.id, id)).get()
    if (!item) return reply.code(404).send({ error: { code: 'not_found', message: 'Media not found' } })
    // Idempotent: liking twice is a no-op.
    app.db
      .insert(likes)
      .values({ userId: req.user!.id, mediaItemId: id, createdAt: Date.now() })
      .onConflictDoNothing()
      .run()
    const body: LikeResponse = { liked: true, likeCount: likeCountOf(app, id) }
    return reply.send(body)
  })

  app.delete('/api/media/:id/like', async (req, reply) => {
    const { id } = req.params as { id: string }
    app.db
      .delete(likes)
      .where(and(eq(likes.userId, req.user!.id), eq(likes.mediaItemId, id)))
      .run()
    const body: LikeResponse = { liked: false, likeCount: likeCountOf(app, id) }
    return reply.send(body)
  })
}
