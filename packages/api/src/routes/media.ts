import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, gte, lte, inArray, asc, desc, count, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { mediaQuerySchema, type MediaCard, type MediaDetail } from '@free-wan/shared'
import {
  mediaItems,
  categories,
  mediaCategories,
  subtitleTracks,
  likes,
  collectionItems,
  repositories,
} from '../db/schema'
import { searchFtsIds } from '../services/fts'
import { resolveWithinRoot } from '../lib/path-safety'
import { contentTypeForExt } from '../lib/content-types'

const sortColumns = {
  title: mediaItems.title,
  added: mediaItems.addedAt,
  created: mediaItems.capturedAt,
  duration: mediaItems.durationS,
  popularity: mediaItems.addedAt, // handled specially (orders by aggregate like count)
} as const

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url')
}
function decodeCursor(c?: string): number {
  if (!c) return 0
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as { o?: unknown }
    return typeof v.o === 'number' && v.o >= 0 ? v.o : 0
  } catch {
    return 0
  }
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  app.get('/api/media', async (req, reply) => {
    const parsed = mediaQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'Invalid query' } })
    }
    const p = parsed.data
    const userId = req.user!.id

    const likeCountExpr = sql<number>`(SELECT COUNT(*) FROM likes WHERE likes.media_item_id = ${mediaItems.id})`
    const likedExpr = sql<number>`(SELECT COUNT(*) FROM likes WHERE likes.media_item_id = ${mediaItems.id} AND likes.user_id = ${userId})`

    const conds: SQL[] = [eq(mediaItems.status, 'active')]
    if (p.type) conds.push(eq(mediaItems.type, p.type))
    if (p.repository) conds.push(eq(mediaItems.repositoryId, p.repository))
    if (p.repositoryType) {
      const types = Array.isArray(p.repositoryType) ? p.repositoryType : [p.repositoryType]
      conds.push(
        inArray(
          mediaItems.repositoryId,
          app.db.select({ id: repositories.id }).from(repositories).where(inArray(repositories.type, types)),
        ),
      )
    }
    if (p.minHeight) conds.push(gte(mediaItems.height, p.minHeight))
    if (p.minDuration !== undefined) conds.push(gte(mediaItems.durationS, p.minDuration))
    if (p.maxDuration !== undefined) conds.push(lte(mediaItems.durationS, p.maxDuration))
    if (p.liked) {
      conds.push(
        sql`EXISTS (SELECT 1 FROM likes WHERE likes.media_item_id = ${mediaItems.id} AND likes.user_id = ${userId})`,
      )
    }
    if (p.category) {
      const cats = Array.isArray(p.category) ? p.category : [p.category]
      conds.push(
        inArray(
          mediaItems.id,
          app.db
            .select({ id: mediaCategories.mediaItemId })
            .from(mediaCategories)
            .where(inArray(mediaCategories.categoryId, cats)),
        ),
      )
    }
    // A collection view only includes (and orders by) its members.
    if (p.collection) {
      conds.push(
        inArray(
          mediaItems.id,
          app.db
            .select({ id: collectionItems.mediaItemId })
            .from(collectionItems)
            .where(eq(collectionItems.collectionId, p.collection)),
        ),
      )
    }
    if (p.q !== undefined) {
      const ids = searchFtsIds(app.db, p.q)
      if (ids !== null) {
        if (ids.length === 0) return { data: [], nextCursor: null, total: 0 }
        conds.push(inArray(mediaItems.id, ids))
      }
    }

    const where = and(...conds)
    const total = app.db.select({ n: count() }).from(mediaItems).where(where).get()?.n ?? 0

    const dir = p.order === 'asc' ? asc : desc
    const offset = decodeCursor(p.cursor)

    let orderBy
    if (p.collection) {
      // Order by the item's position within the collection.
      orderBy = sql`(SELECT position FROM collection_items WHERE collection_items.media_item_id = ${mediaItems.id} AND collection_items.collection_id = ${p.collection}) ASC`
    } else if (p.sort === 'popularity') {
      orderBy = p.order === 'asc' ? asc(likeCountExpr) : desc(likeCountExpr)
    } else {
      orderBy = dir(sortColumns[p.sort])
    }

    const rows = app.db
      .select({
        id: mediaItems.id,
        type: mediaItems.type,
        title: mediaItems.title,
        durationS: mediaItems.durationS,
        width: mediaItems.width,
        height: mediaItems.height,
        repositoryId: mediaItems.repositoryId,
        categoryPath: categories.path,
        likeCount: likeCountExpr,
        liked: likedExpr,
      })
      .from(mediaItems)
      .leftJoin(
        mediaCategories,
        and(eq(mediaCategories.mediaItemId, mediaItems.id), eq(mediaCategories.isLeaf, 1)),
      )
      .leftJoin(categories, eq(categories.id, mediaCategories.categoryId))
      .where(where)
      .orderBy(orderBy, desc(mediaItems.id))
      .limit(p.limit)
      .offset(offset)
      .all()

    const data: MediaCard[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      durationS: r.durationS,
      width: r.width,
      height: r.height,
      posterUrl: `/api/media/${r.id}/poster`,
      repositoryId: r.repositoryId,
      categoryPath: r.categoryPath ?? null,
      liked: Number(r.liked) > 0,
      likeCount: Number(r.likeCount),
    }))
    const nextCursor = offset + p.limit < total ? encodeCursor(offset + p.limit) : null
    return { data, nextCursor, total }
  })

  app.get('/api/media/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const item = app.db
      .select()
      .from(mediaItems)
      .where(and(eq(mediaItems.id, id), eq(mediaItems.status, 'active')))
      .get()
    if (!item) return reply.code(404).send({ error: { code: 'not_found', message: 'Media not found' } })

    const cats = app.db
      .select({ id: categories.id, name: categories.name, path: categories.path, depth: categories.depth })
      .from(mediaCategories)
      .innerJoin(categories, eq(categories.id, mediaCategories.categoryId))
      .where(eq(mediaCategories.mediaItemId, id))
      .all()
    cats.sort((a, b) => a.depth - b.depth)
    const subs = app.db.select().from(subtitleTracks).where(eq(subtitleTracks.mediaItemId, id)).all()
    const likeCount = app.db.select({ n: count() }).from(likes).where(eq(likes.mediaItemId, id)).get()?.n ?? 0
    const liked = Boolean(
      app.db
        .select({ userId: likes.userId })
        .from(likes)
        .where(and(eq(likes.mediaItemId, id), eq(likes.userId, req.user!.id)))
        .get(),
    )

    const detail: MediaDetail = {
      id: item.id,
      type: item.type,
      title: item.title,
      durationS: item.durationS,
      width: item.width,
      height: item.height,
      posterUrl: `/api/media/${item.id}/poster`,
      repositoryId: item.repositoryId,
      categoryPath: cats.length ? cats[cats.length - 1]!.path : null,
      liked,
      likeCount,
      ext: item.ext,
      sizeBytes: item.sizeBytes,
      frameRate: item.frameRate,
      bitrate: item.bitrate,
      container: item.container,
      videoCodec: item.videoCodec,
      audioCodec: item.audioCodec,
      audioTracks: item.audioTracks ?? 0,
      playbackMode: item.playbackMode,
      capturedAt: item.capturedAt,
      addedAt: item.addedAt,
      relPath: item.relPath,
      categories: cats.map((c) => ({ id: c.id, name: c.name, path: c.path })),
      subtitles: subs.map((s) => ({
        id: s.id,
        kind: s.kind,
        language: s.language,
        label: s.label,
        format: s.format,
      })),
    }
    return detail
  })

  app.get('/api/media/:id/poster', async (req, reply) => {
    const { id } = req.params as { id: string }
    const item = app.db
      .select({ posterPath: mediaItems.posterPath })
      .from(mediaItems)
      .where(eq(mediaItems.id, id))
      .get()
    if (!item?.posterPath) return reply.code(404).send({ error: { code: 'not_found', message: 'No poster' } })
    const abs = join(app.config.dataDir, item.posterPath)
    if (!existsSync(abs)) return reply.code(404).send({ error: { code: 'not_found', message: 'No poster' } })
    reply.header('Cache-Control', 'public, max-age=86400').type('image/jpeg')
    return reply.send(createReadStream(abs))
  })

  // Original image bytes, or a width-resized JPEG variant via ?w= (FR-38). Images only.
  app.get('/api/media/:id/raw', async (req, reply) => {
    const { id } = req.params as { id: string }
    const item = app.db
      .select()
      .from(mediaItems)
      .where(and(eq(mediaItems.id, id), eq(mediaItems.status, 'active')))
      .get()
    if (!item || item.type !== 'image') return reply.code(404).send({ error: { code: 'not_found', message: 'Image not found' } })
    const repo = app.db.select().from(repositories).where(eq(repositories.id, item.repositoryId)).get()
    if (!repo) return reply.code(404).send({ error: { code: 'not_found', message: 'Image not found' } })

    let abs: string
    try {
      abs = resolveWithinRoot(repo.rootPath, item.relPath)
    } catch {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Image not found' } })
    }

    const wRaw = (req.query as { w?: string }).w
    const width = wRaw ? Math.max(64, Math.min(3840, Math.trunc(Number(wRaw)))) : null

    if (!width || Number.isNaN(width)) {
      reply.header('Cache-Control', 'public, max-age=86400').type(contentTypeForExt(item.ext))
      return reply.send(createReadStream(abs))
    }

    const outDir = join(app.config.dataDir, 'thumbs', item.id)
    const outPath = join(outDir, `w${width}.jpg`)
    if (!existsSync(outPath)) {
      mkdirSync(outDir, { recursive: true })
      try {
        await app.imageVariant({ absPath: abs, width, outPath })
      } catch {
        // Fall back to the original on any resize failure.
        reply.header('Cache-Control', 'public, max-age=86400').type(contentTypeForExt(item.ext))
        return reply.send(createReadStream(abs))
      }
    }
    reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('image/jpeg')
    return reply.send(createReadStream(outPath))
  })
}
