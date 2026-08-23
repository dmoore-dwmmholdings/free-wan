import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, sep, dirname } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { and, eq, count, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Db } from '../db/client'
import {
  repositories,
  mediaItems,
  categories,
  mediaCategories,
  subtitleTracks,
  type RepositoryRow,
  type MediaItemRow,
} from '../db/schema'
import {
  classify,
  isIgnored,
  isSubtitle,
  extOf,
  stemOf,
  titleFromFilename,
  type MediaKind,
} from '../lib/media-types'
import { deriveCategoryChain } from '../lib/categories'
import { decidePlaybackMode } from '../lib/playback'
import { upsertFts } from './fts'
import type { Prober, ProbeResult } from './ffprobe'

export interface ScanResult {
  found: number
  indexed: number
  failed: number
  removed: number
}

export interface ScanProgress extends ScanResult {
  status: 'scanning' | 'online' | 'offline'
  progress: number
}

interface WalkedFile {
  abs: string
  rel: string // posix-style, relative to repo root
  name: string
  size: number
  mtime: number
}

async function walk(root: string): Promise<WalkedFile[]> {
  const out: WalkedFile[] = []
  async function rec(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable dir — skip, never fatal (NFR-05)
    }
    for (const ent of entries) {
      if (isIgnored(ent.name)) continue
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) {
        await rec(abs)
      } else if (ent.isFile()) {
        try {
          const st = await stat(abs)
          out.push({
            abs,
            rel: relative(root, abs).split(sep).join('/'),
            name: ent.name,
            size: st.size,
            mtime: Math.floor(st.mtimeMs),
          })
        } catch {
          /* vanished between readdir and stat — ignore */
        }
      }
    }
  }
  await rec(root)
  return out
}

/** Sidecar subtitles in the same directory that share the media file's stem. */
function matchSidecars(mediaName: string, siblings: WalkedFile[]): Array<{ rel: string; language?: string }> {
  const stem = stemOf(mediaName)
  const matches: Array<{ rel: string; language?: string }> = []
  for (const s of siblings) {
    if (!isSubtitle(s.name)) continue
    const subStem = stemOf(s.name) // e.g. "film.en" or "film"
    if (subStem === stem) {
      matches.push({ rel: s.rel })
    } else if (subStem.startsWith(`${stem}.`)) {
      matches.push({ rel: s.rel, language: subStem.slice(stem.length + 1) })
    }
  }
  return matches
}

function upsertCategoryChain(db: Db, repoId: string, rel: string, itemId: string): void {
  // Replace this item's category links, then (re)create the nodes along its chain.
  db.delete(mediaCategories).where(eq(mediaCategories.mediaItemId, itemId)).run()
  const chain = deriveCategoryChain(rel)
  let parentId: string | null = null
  chain.forEach((node, i) => {
    let cat = db
      .select()
      .from(categories)
      // Case-insensitive match (spec: first-seen display case wins) — pairs with the
      // COLLATE NOCASE unique index from migration 0012.
      .where(and(eq(categories.repositoryId, repoId), sql`${categories.path} = ${node.path} COLLATE NOCASE`))
      .get()
    if (!cat) {
      cat = {
        id: uuidv7(),
        repositoryId: repoId,
        parentId,
        name: node.name,
        path: node.path,
        depth: node.depth,
        itemCount: 0,
      }
      db.insert(categories).values(cat).run()
    }
    db.insert(mediaCategories)
      .values({ mediaItemId: itemId, categoryId: cat.id, isLeaf: i === chain.length - 1 ? 1 : 0 })
      .onConflictDoNothing()
      .run()
    parentId = cat.id
  })
}

function upsertSubtitles(
  db: Db,
  itemId: string,
  probe: ProbeResult | undefined,
  sidecars: Array<{ rel: string; language?: string }>,
): void {
  db.delete(subtitleTracks).where(eq(subtitleTracks.mediaItemId, itemId)).run()
  for (const s of probe?.embeddedSubs ?? []) {
    db.insert(subtitleTracks)
      .values({
        id: uuidv7(),
        mediaItemId: itemId,
        kind: 'embedded',
        language: s.language ?? null,
        label: null,
        format: s.format ?? null,
        streamIndex: s.streamIndex,
        relPath: null,
      })
      .run()
  }
  for (const s of sidecars) {
    db.insert(subtitleTracks)
      .values({
        id: uuidv7(),
        mediaItemId: itemId,
        kind: 'sidecar',
        language: s.language ?? null,
        label: null,
        format: extOf(s.rel),
        streamIndex: null,
        relPath: s.rel,
      })
      .run()
  }
}

function upsertItem(
  db: Db,
  repo: RepositoryRow,
  f: WalkedFile,
  kind: MediaKind,
  probe: ProbeResult | undefined,
  prior: MediaItemRow | undefined,
  sidecars: Array<{ rel: string; language?: string }>,
): string {
  const now = Date.now()
  const fields = {
    relPath: f.rel,
    type: kind,
    title: titleFromFilename(f.name),
    ext: extOf(f.name),
    sizeBytes: f.size,
    fileMtime: f.mtime,
    status: 'active' as const,
    durationS: probe?.durationS ?? null,
    width: probe?.width ?? null,
    height: probe?.height ?? null,
    frameRate: probe?.frameRate ?? null,
    bitrate: probe?.bitrate ?? null,
    container: probe?.container ?? null,
    videoCodec: probe?.videoCodec ?? null,
    audioCodec: probe?.audioCodec ?? null,
    audioTracks: probe?.audioTracks ?? 0,
    hasEmbeddedSubs: probe && probe.embeddedSubs.length > 0 ? 1 : 0,
    capturedAt: probe?.capturedAt ?? null,
    playbackMode:
      kind === 'video' && probe
        ? decidePlaybackMode({
            ext: extOf(f.name),
            videoCodec: probe.videoCodec,
            audioCodec: probe.audioCodec,
          })
        : null,
    updatedAt: now,
  }

  let itemId: string
  if (prior) {
    itemId = prior.id
    db.update(mediaItems).set(fields).where(eq(mediaItems.id, prior.id)).run()
  } else {
    itemId = uuidv7()
    db.insert(mediaItems).values({ id: itemId, repositoryId: repo.id, addedAt: now, ...fields }).run()
  }

  upsertCategoryChain(db, repo.id, f.rel, itemId)
  upsertSubtitles(db, itemId, probe, sidecars)

  // Keep the search index in sync (title + filename + folder-derived category names).
  const categoryNames = deriveCategoryChain(f.rel)
    .map((n) => n.name)
    .join(' ')
  upsertFts(db, itemId, { title: fields.title, filename: f.name, categories: categoryNames })

  return itemId
}

function refreshCategoryCounts(db: Db, repoId: string): void {
  // One grouped count for all categories (not one COUNT per node), and only write rows whose
  // count actually changed — a no-op rescan of a large library used to rewrite every category.
  const counts = new Map(
    db
      .select({ categoryId: mediaCategories.categoryId, n: count() })
      .from(mediaCategories)
      .innerJoin(mediaItems, eq(mediaCategories.mediaItemId, mediaItems.id))
      .where(eq(mediaItems.status, 'active'))
      .groupBy(mediaCategories.categoryId)
      .all()
      .map((r) => [r.categoryId, r.n]),
  )
  const cats = db.select().from(categories).where(eq(categories.repositoryId, repoId)).all()
  for (const c of cats) {
    const n = counts.get(c.id) ?? 0
    if (n !== c.itemCount) db.update(categories).set({ itemCount: n }).where(eq(categories.id, c.id)).run()
  }
  // Prune now-empty nodes (cascades to any 0-count children via parent_id FK).
  db.delete(categories)
    .where(and(eq(categories.repositoryId, repoId), eq(categories.itemCount, 0)))
    .run()
}

export interface ScanOptions {
  setProgress?: (p: number) => void
  onProgress?: (snapshot: ScanProgress) => void
  /** Called with each newly-indexed/changed item id (the app enqueues a thumbnail job). */
  onIndexed?: (itemId: string, type: MediaKind) => void
  log?: FastifyBaseLogger
}

/**
 * Scan one repository: incremental walk + probe + categorize, with offline/missing
 * handling (media pipeline §2). Per-file failures are counted, never fatal.
 */
export async function runScan(
  db: Db,
  repositoryId: string,
  prober: Prober,
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const repo = db.select().from(repositories).where(eq(repositories.id, repositoryId)).get()
  if (!repo) throw new Error(`repository ${repositoryId} not found`)

  const result: ScanResult = { found: 0, indexed: 0, failed: 0, removed: 0 }

  // Offline: root unreachable → mark repo + its items offline, do not delete (FR-03).
  if (!existsSync(repo.rootPath)) {
    const now = Date.now()
    db.update(repositories)
      .set({ status: 'offline', updatedAt: now })
      .where(eq(repositories.id, repo.id))
      .run()
    db.update(mediaItems)
      .set({ status: 'offline', updatedAt: now })
      .where(eq(mediaItems.repositoryId, repo.id))
      .run()
    opts.onProgress?.({ status: 'offline', progress: 0, ...result })
    return result
  }

  db.update(repositories)
    .set({ status: 'scanning', updatedAt: Date.now() })
    .where(eq(repositories.id, repo.id))
    .run()
  opts.onProgress?.({ status: 'scanning', progress: 0, ...result })

  const existing = db.select().from(mediaItems).where(eq(mediaItems.repositoryId, repo.id)).all()
  const byRel = new Map(existing.map((e) => [e.relPath, e]))
  const seen = new Set<string>()

  const files = await walk(repo.rootPath)
  const byDir = new Map<string, WalkedFile[]>()
  for (const f of files) {
    const d = dirname(f.rel)
    const arr = byDir.get(d)
    if (arr) arr.push(f)
    else byDir.set(d, [f])
  }

  // Throttle progress to whole-percent changes: emitting per file means one jobs-table
  // UPDATE and one WebSocket push per file, which crawls on large libraries.
  let lastPct = -1

  for (const f of files) {
    const kind = classify(f.name)
    if (!kind) continue
    result.found++
    seen.add(f.rel)

    const prior = byRel.get(f.rel)
    if (prior && prior.sizeBytes === f.size && prior.fileMtime === f.mtime && prior.status === 'active') {
      continue // unchanged signature → incremental skip (FR-12)
    }

    try {
      let probe: ProbeResult | undefined
      try {
        probe = await prober(f.abs)
      } catch (e) {
        // A probe failure is non-fatal: index with what we know (name, size).
        opts.log?.debug?.(`probe failed for ${f.rel}: ${String(e)}`)
      }
      const sidecars = matchSidecars(f.name, byDir.get(dirname(f.rel)) ?? [])
      const itemId = upsertItem(db, repo, f, kind, probe, prior, sidecars)
      result.indexed++
      opts.onIndexed?.(itemId, kind)
    } catch (e) {
      result.failed++
      opts.log?.warn?.(`indexing failed for ${f.rel}: ${String(e)}`)
    }
    const progress = result.found > 0 ? result.indexed / result.found : 1
    const pct = Math.floor(progress * 100)
    if (pct !== lastPct) {
      lastPct = pct
      opts.setProgress?.(progress)
      opts.onProgress?.({ status: 'scanning', progress, ...result })
    }
  }

  // Sweep: previously-known items not seen this pass are missing; returned items revive.
  const now = Date.now()
  for (const e of existing) {
    if (!seen.has(e.relPath)) {
      db.update(mediaItems).set({ status: 'missing', updatedAt: now }).where(eq(mediaItems.id, e.id)).run()
      result.removed++
    } else if (e.status !== 'active') {
      db.update(mediaItems).set({ status: 'active', updatedAt: now }).where(eq(mediaItems.id, e.id)).run()
    }
  }

  refreshCategoryCounts(db, repo.id)

  db.update(repositories)
    .set({ status: 'online', lastScanAt: now, lastError: null, updatedAt: now })
    .where(eq(repositories.id, repo.id))
    .run()

  opts.onProgress?.({ status: 'online', progress: 1, ...result })
  return result
}
