import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { jobs, type JobRow } from '../db/schema'
import type { Db } from '../db/client'

export function enqueueJob(db: Db, type: string, payload: unknown, priority = 0): string {
  const id = uuidv7()
  db.insert(jobs)
    .values({
      id,
      type,
      payload: JSON.stringify(payload ?? {}),
      status: 'queued',
      priority,
      progress: 0,
      attempts: 0,
      createdAt: Date.now(),
    })
    .run()
  return id
}

export function getJob(db: Db, id: string): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()
}
