import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { v7 as uuidv7 } from 'uuid'
import { and, eq, count } from 'drizzle-orm'
import { openDatabase, type Db } from '../src/db/client'
import { runMigrations } from '../src/db/migrate'
import { repositories, mediaItems, categories, mediaCategories, subtitleTracks } from '../src/db/schema'
import { runScan } from '../src/services/scanner'
import type { Prober, ProbeResult } from '../src/services/ffprobe'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// Fake prober: video → browser-friendly h264/aac; image → just dimensions.
const fakeProber: Prober = async (abs) => {
  const base: ProbeResult = { audioTracks: 0, embeddedSubs: [] }
  if (abs.endsWith('.mp4')) {
    return {
      durationS: 120,
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 4_000_000,
      container: 'mov,mp4,m4a',
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioTracks: 1,
      embeddedSubs: [],
    }
  }
  return { ...base, width: 800, height: 600 }
}

async function seedTree(root: string): Promise<void> {
  await mkdir(join(root, 'Movies', 'Action', '2021'), { recursive: true })
  await mkdir(join(root, 'Photos'), { recursive: true })
  await writeFile(join(root, 'Movies', 'Action', '2021', 'film.mp4'), 'x')
  await writeFile(join(root, 'Movies', 'Action', '2021', 'film.en.srt'), 'WEBVTT')
  await writeFile(join(root, 'Photos', 'cat.jpg'), 'x')
  await writeFile(join(root, 'root.mp4'), 'x')
  await writeFile(join(root, '.hidden.mp4'), 'x') // ignored
  await writeFile(join(root, 'download.part'), 'x') // ignored
}

describe('scanner', () => {
  let db: Db
  let sqlite: ReturnType<typeof openDatabase>['sqlite']
  let root: string
  let repoId: string

  beforeAll(async () => {
    const handle = openDatabase(':memory:')
    db = handle.db
    sqlite = handle.sqlite
    runMigrations(sqlite, migrationsFolder)
    root = await mkdtemp(join(tmpdir(), 'fw-scan-'))
    await seedTree(root)
    const now = Date.now()
    repoId = uuidv7()
    db.insert(repositories)
      .values({
        id: repoId,
        name: 'Test',
        rootPath: root,
        type: 'mixed',
        enabled: 1,
        readOnly: 1,
        status: 'unknown',
        lastScanAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  })

  afterAll(async () => {
    sqlite.close()
    await rm(root, { recursive: true, force: true })
  })

  function catByPath(path: string) {
    return db.select().from(categories).where(and(eq(categories.repositoryId, repoId), eq(categories.path, path))).get()
  }

  it('indexes media, ignores junk, derives categories and a sidecar', async () => {
    const r = await runScan(db, repoId, fakeProber)
    expect(r).toMatchObject({ found: 3, indexed: 3, failed: 0, removed: 0 })

    const items = db.select().from(mediaItems).where(eq(mediaItems.repositoryId, repoId)).all()
    expect(items).toHaveLength(3)
    expect(items.every((i) => i.status === 'active')).toBe(true)

    const film = items.find((i) => i.relPath === 'Movies/Action/2021/film.mp4')!
    expect(film.type).toBe('video')
    expect(film.playbackMode).toBe('direct')
    expect(film.width).toBe(1920)

    // category chain + counts
    expect(catByPath('Movies')?.itemCount).toBe(1)
    expect(catByPath('Movies/Action/2021')?.itemCount).toBe(1)
    expect(catByPath('Photos')?.itemCount).toBe(1)
    const links = db.select({ n: count() }).from(mediaCategories).where(eq(mediaCategories.mediaItemId, film.id)).get()
    expect(links?.n).toBe(3) // Movies, Movies/Action, Movies/Action/2021

    // sidecar subtitle with inferred language
    const subs = db.select().from(subtitleTracks).where(eq(subtitleTracks.mediaItemId, film.id)).all()
    expect(subs).toHaveLength(1)
    expect(subs[0]).toMatchObject({ kind: 'sidecar', language: 'en' })

    // repo marked online
    expect(db.select().from(repositories).where(eq(repositories.id, repoId)).get()?.status).toBe('online')
  })

  it('is incremental on an unchanged tree (indexed = 0)', async () => {
    const r = await runScan(db, repoId, fakeProber)
    expect(r.found).toBe(3)
    expect(r.indexed).toBe(0)
  })

  it('marks a removed file missing and prunes its now-empty categories', async () => {
    await rm(join(root, 'Movies', 'Action', '2021', 'film.mp4'))
    await rm(join(root, 'Movies', 'Action', '2021', 'film.en.srt'))
    const r = await runScan(db, repoId, fakeProber)
    expect(r.removed).toBe(1)

    const film = db.select().from(mediaItems).where(eq(mediaItems.relPath, 'Movies/Action/2021/film.mp4')).get()
    expect(film?.status).toBe('missing')
    // empty Movies* nodes pruned; Photos remains
    expect(catByPath('Movies/Action/2021')).toBeUndefined()
    expect(catByPath('Photos')?.itemCount).toBe(1)
  })

  it('marks the repository and items offline when the root is unreachable', async () => {
    db.update(repositories).set({ rootPath: join(root, 'does-not-exist') }).where(eq(repositories.id, repoId)).run()
    await runScan(db, repoId, fakeProber)
    expect(db.select().from(repositories).where(eq(repositories.id, repoId)).get()?.status).toBe('offline')
    const stuck = db.select().from(mediaItems).where(eq(mediaItems.repositoryId, repoId)).all()
    expect(stuck.every((i) => i.status === 'offline')).toBe(true)
  })
})
