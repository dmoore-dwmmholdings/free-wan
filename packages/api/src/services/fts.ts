import { sql } from 'drizzle-orm'
import type { Db } from '../db/client'

export interface FtsDoc {
  title: string
  filename: string
  categories: string
}

/**
 * Turn raw user input into a safe FTS5 MATCH expression: each whitespace term becomes a
 * quoted prefix match, AND-ed together. Quoting makes metacharacters literal, so the value
 * (bound as a parameter) can never break FTS5 query syntax.
 */
export function ftsQueryString(raw: string): string {
  const terms = raw.trim().split(/\s+/).filter(Boolean).slice(0, 16)
  if (terms.length === 0) return ''
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

export function upsertFts(db: Db, itemId: string, doc: FtsDoc): void {
  db.run(sql`DELETE FROM media_fts WHERE media_item_id = ${itemId}`)
  db.run(
    sql`INSERT INTO media_fts (media_item_id, title, filename, categories)
        VALUES (${itemId}, ${doc.title}, ${doc.filename}, ${doc.categories})`,
  )
}

export function deleteFts(db: Db, itemId: string): void {
  db.run(sql`DELETE FROM media_fts WHERE media_item_id = ${itemId}`)
}

/** Matching media_item_ids for a raw query, or null when the query is empty. */
export function searchFtsIds(db: Db, raw: string): string[] | null {
  const q = ftsQueryString(raw)
  if (!q) return null
  const rows = db.all(
    sql`SELECT media_item_id AS id FROM media_fts WHERE media_fts MATCH ${q}`,
  ) as Array<{ id: string }>
  return rows.map((r) => r.id)
}
