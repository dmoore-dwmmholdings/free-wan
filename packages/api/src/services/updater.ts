import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, cpSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

/** Exit code the app uses to ask the supervisor to relaunch it after applying an update. */
export const UPDATE_RESTART_CODE = 75
export const SUPPORTED_FORMAT = 1

/** Thrown for bad/rejected packages — the route maps these to 4xx with the message. */
export class UpdateError extends Error {}

export interface UpdatePaths {
  apiDist: string // packages/api/dist
  apiMigrations: string // packages/api/migrations
  webDist: string // packages/web/dist
  work: string // <repoRoot>/.fw-update  (staging, backups, pending.json) — never DATA_DIR
}

export interface Manifest {
  formatVersion: number
  name?: string
  version: string
  builtAt?: string
  changelog?: string
  sha256?: Record<string, string>
}

export interface ApplyResult {
  version: string
  changelog: string
  backupDir: string
}

export interface PendingUpdate {
  version: string
  backupDir: string
}

const REQUIRED_FILES = ['api/dist/index.js', 'web/dist/index.html']

/** Runtime locations, derived from the running bundle (packages/api/dist). Never DATA_DIR. */
export function resolvePaths(here = dirname(fileURLToPath(import.meta.url))): UpdatePaths {
  const apiDir = dirname(here) // packages/api
  const packagesDir = dirname(apiDir) // packages
  const repoRoot = dirname(packagesDir) // free-wan
  return {
    apiDist: join(apiDir, 'dist'),
    apiMigrations: join(apiDir, 'migrations'),
    webDist: join(packagesDir, 'web', 'dist'),
    work: join(repoRoot, '.fw-update'),
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Move a directory, preferring atomic rename; fall back to copy+remove (Windows locks / EXDEV). */
async function moveDir(src: string, dest: string): Promise<void> {
  if (!existsSync(src)) return
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(src, dest)
      return
    } catch (e) {
      if (attempt >= 4) {
        cpSync(src, dest, { recursive: true })
        rmSync(src, { recursive: true, force: true })
        return
      }
      await delay(150)
    }
  }
}

/** Validate a package archive without touching anything on disk. */
export function validatePackage(zipPath: string): { manifest: Manifest; zip: AdmZip } {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch {
    throw new UpdateError('Not a valid .zip package')
  }
  const mEntry = zip.getEntry('manifest.json')
  if (!mEntry) throw new UpdateError('Package is missing manifest.json')

  let manifest: Manifest
  try {
    manifest = JSON.parse(zip.readAsText(mEntry)) as Manifest
  } catch {
    throw new UpdateError('Package manifest.json is not valid JSON')
  }
  if (manifest.formatVersion !== SUPPORTED_FORMAT) {
    throw new UpdateError(`Unsupported package format ${manifest.formatVersion} (expected ${SUPPORTED_FORMAT})`)
  }
  if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    throw new UpdateError('Package manifest has no valid version')
  }
  for (const req of REQUIRED_FILES) {
    if (!zip.getEntry(req)) throw new UpdateError(`Package is missing ${req}`)
  }
  if (!zip.getEntries().some((e) => e.entryName.startsWith('api/migrations/'))) {
    throw new UpdateError('Package is missing api/migrations')
  }
  if (manifest.sha256) {
    for (const [name, expected] of Object.entries(manifest.sha256)) {
      const e = zip.getEntry(name)
      if (!e) throw new UpdateError(`Checksum references a missing file: ${name}`)
      const actual = createHash('sha256').update(e.getData()).digest('hex')
      if (actual !== expected) throw new UpdateError(`Checksum mismatch for ${name}`)
    }
  }
  return { manifest, zip }
}

function restore(backupDir: string, paths: UpdatePaths): Promise<void[]> {
  return Promise.all([
    moveDir(join(backupDir, 'api-dist'), paths.apiDist),
    moveDir(join(backupDir, 'api-migrations'), paths.apiMigrations),
    moveDir(join(backupDir, 'web-dist'), paths.webDist),
  ])
}

/**
 * Apply a validated package: stage → back up current code → swap in new code. On any failure
 * during backup/swap, the previous code is restored. Only ever writes under `paths` (the three
 * code dirs + `work`); DATA_DIR and env config are never touched.
 */
export async function applyPackage(zipPath: string, paths: UpdatePaths): Promise<ApplyResult> {
  const { manifest, zip } = validatePackage(zipPath)

  const staging = join(paths.work, 'staging')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  zip.extractAllTo(staging, true)

  const backupDir = join(paths.work, 'backups', `${manifest.version}-${Date.now()}`)
  mkdirSync(backupDir, { recursive: true })

  // Back up the current code so we can roll back.
  await moveDir(paths.apiDist, join(backupDir, 'api-dist'))
  await moveDir(paths.apiMigrations, join(backupDir, 'api-migrations'))
  await moveDir(paths.webDist, join(backupDir, 'web-dist'))

  try {
    await moveDir(join(staging, 'api', 'dist'), paths.apiDist)
    await moveDir(join(staging, 'api', 'migrations'), paths.apiMigrations)
    await moveDir(join(staging, 'web', 'dist'), paths.webDist)
  } catch (e) {
    await restore(backupDir, paths)
    throw new UpdateError(`Failed to apply update; previous version restored. (${String(e)})`)
  }

  writePending(paths, { version: manifest.version, backupDir })
  rmSync(staging, { recursive: true, force: true })
  return { version: manifest.version, changelog: manifest.changelog ?? '', backupDir }
}

/** Roll back to the most recent backup (newest dir under work/backups). */
export async function rollbackLatest(paths: UpdatePaths): Promise<{ restoredFrom: string }> {
  const backups = join(paths.work, 'backups')
  if (!existsSync(backups)) throw new UpdateError('No backup to roll back to')
  const dirs = readdirSync(backups)
    .map((name) => join(backups, name))
    .sort()
  const latest = dirs[dirs.length - 1]
  if (!latest) throw new UpdateError('No backup to roll back to')
  await restore(latest, paths)
  clearPending(paths)
  return { restoredFrom: latest }
}

export function writePending(paths: UpdatePaths, pending: PendingUpdate): void {
  mkdirSync(paths.work, { recursive: true })
  writeFileSync(join(paths.work, 'pending.json'), JSON.stringify(pending))
}

export function readPending(paths: UpdatePaths): PendingUpdate | null {
  const p = join(paths.work, 'pending.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PendingUpdate
  } catch {
    return null
  }
}

export function clearPending(paths: UpdatePaths): void {
  rmSync(join(paths.work, 'pending.json'), { force: true })
}
