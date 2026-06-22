import { eq } from 'drizzle-orm'
import { brandingSchema, DEFAULT_BRANDING, type Branding } from '@free-wan/shared'
import { settings } from '../db/schema'
import type { Db } from '../db/client'

const KEY = 'branding'

export function getBranding(db: Db): Branding {
  const row = db.select().from(settings).where(eq(settings.key, KEY)).get()
  if (!row) return DEFAULT_BRANDING
  try {
    const parsed = brandingSchema.safeParse(JSON.parse(row.value))
    return parsed.success ? parsed.data : DEFAULT_BRANDING
  } catch {
    return DEFAULT_BRANDING
  }
}

export function setBranding(db: Db, branding: Branding): void {
  const value = JSON.stringify(branding)
  const now = Date.now()
  db.insert(settings)
    .values({ key: KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
    .run()
}
