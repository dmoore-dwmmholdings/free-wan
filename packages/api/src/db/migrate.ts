import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * Apply all pending SQL migrations in `migrationsFolder` using Drizzle's
 * better-sqlite3 migrator. No-ops if the folder does not exist yet.
 */
export function runMigrations(sqlite: Database.Database, migrationsFolder: string): void {
  if (!existsSync(migrationsFolder)) return
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })
}
