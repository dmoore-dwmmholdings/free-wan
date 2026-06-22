import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  db: Db
  sqlite: Database.Database
}

/** Open (and create if needed) the SQLite database under `dataDir`. */
export function openDatabase(dataDir: string): DbHandle {
  const dbPath = dataDir === ':memory:' ? ':memory:' : join(dataDir, 'free-wan.db')
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })

  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}
