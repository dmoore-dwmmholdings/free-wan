import { and, eq, isNull, asc, sql, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { repositoryTypeSchema, type CategoryNodeDto } from '@free-wan/shared'
import { categories, repositories } from '../db/schema'

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate)

  // Children of a node (or repository roots), for tree/breadcrumb navigation (FR-20).
  app.get('/api/categories', async (req) => {
    const q = req.query as { repository?: string; parent?: string; repositoryType?: string | string[] }

    const conds = []
    if (q.parent) conds.push(eq(categories.parentId, q.parent))
    else conds.push(isNull(categories.parentId))
    if (q.repository) conds.push(eq(categories.repositoryId, q.repository))
    // Scope the tree to repositories of the given type(s) — keeps the Photos/Video tabs
    // from showing each other's folders.
    const types = (Array.isArray(q.repositoryType) ? q.repositoryType : q.repositoryType ? [q.repositoryType] : [])
      .filter((t): t is ReturnType<typeof repositoryTypeSchema.parse> => repositoryTypeSchema.safeParse(t).success)
    if (types.length) {
      conds.push(
        inArray(
          categories.repositoryId,
          app.db.select({ id: repositories.id }).from(repositories).where(inArray(repositories.type, types)),
        ),
      )
    }

    const rows = app.db
      .select()
      .from(categories)
      .where(and(...conds))
      .orderBy(asc(categories.name))
      .all()

    const data: CategoryNodeDto[] = rows.map((c) => {
      const child = app.db
        .select({ n: sql<number>`1` })
        .from(categories)
        .where(eq(categories.parentId, c.id))
        .limit(1)
        .get()
      return {
        id: c.id,
        name: c.name,
        path: c.path,
        depth: c.depth,
        itemCount: c.itemCount,
        hasChildren: Boolean(child),
      }
    })
    return { data }
  })

  // One node plus its ancestor chain (breadcrumbs).
  app.get('/api/categories/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const node = app.db.select().from(categories).where(eq(categories.id, id)).get()
    if (!node) return reply.code(404).send({ error: { code: 'not_found', message: 'Category not found' } })

    const ancestors: Array<{ id: string; name: string; path: string }> = []
    let cur = node.parentId
    while (cur) {
      const parent = app.db.select().from(categories).where(eq(categories.id, cur)).get()
      if (!parent) break
      ancestors.unshift({ id: parent.id, name: parent.name, path: parent.path })
      cur = parent.parentId
    }

    return {
      id: node.id,
      name: node.name,
      path: node.path,
      depth: node.depth,
      itemCount: node.itemCount,
      repositoryId: node.repositoryId,
      ancestors,
    }
  })
}
