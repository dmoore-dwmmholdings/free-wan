import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { eq } from 'drizzle-orm'
// Type-only import (erased at build time) so the bundle has no top-level adm-zip require.
import type AdmZipType from 'adm-zip'
import type { Db } from '../db/client'
import { plugins } from '../db/schema'
import { loadManifest } from '../lib/plugin-manifest'

export class PluginInstallError extends Error {}

/** Load adm-zip on demand; only zip/url installs need it. */
async function loadAdmZip(): Promise<typeof AdmZipType> {
  try {
    const mod = (await import('adm-zip')) as unknown as { default: typeof AdmZipType }
    return mod.default ?? (mod as unknown as typeof AdmZipType)
  } catch {
    throw new PluginInstallError(
      'Installing a zipped/remote plugin needs the "adm-zip" package, which is not installed. Run "pnpm install" on the server.',
    )
  }
}

export interface InstallResult {
  id: string
  name: string
  version: string
  /** True when an existing install of this id was replaced (an upgrade/reinstall). */
  replaced: boolean
}

/** Called with the manifest id right before an existing install's files are replaced, so the
 *  caller can stop the running process (which on Windows otherwise locks its install dir). */
export type BeforeReplace = (pluginId: string) => Promise<void> | void

/** Where installed plugins live on disk. */
export function pluginsRoot(dataDir: string): string {
  return join(dataDir, 'plugins')
}

/**
 * Install a plugin from an extracted/source directory: validate its manifest, copy it into
 * DATA_DIR/plugins/<id>, and upsert the `plugins` row (disabled until the admin enables it).
 * Reinstalling an existing id replaces the files and bumps the version, preserving config.
 */
export async function installFromDirectory(
  db: Db,
  dataDir: string,
  srcDir: string,
  installedBy: string | null,
  beforeReplace?: BeforeReplace,
): Promise<InstallResult> {
  // The package may be the manifest dir itself or a single wrapper folder containing it.
  const dir = locateManifestDir(srcDir)
  const { manifest, icon } = loadManifest(dir)

  // Always store an ABSOLUTE install path: the plugin child is forked with cwd=installPath, so a
  // relative path (DATA_DIR defaults to ./data) would otherwise be resolved twice in the child.
  const dest = resolve(pluginsRoot(dataDir), manifest.id)
  const existing = db.select().from(plugins).where(eq(plugins.id, manifest.id)).get()

  // Stop a running instance first so its install dir isn't locked (Windows), then replace files.
  if (existing) await beforeReplace?.(manifest.id)
  mkdirSync(pluginsRoot(dataDir), { recursive: true })
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
  cpSync(dir, dest, { recursive: true })

  const now = Date.now()
  if (existing) {
    db.update(plugins)
      .set({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? null,
        author: manifest.author ?? null,
        icon,
        main: manifest.main,
        manifest: JSON.stringify(manifest),
        permissions: JSON.stringify(manifest.permissions),
        daemon: manifest.daemon ? 1 : 0,
        installPath: dest,
        updatedAt: now,
      })
      .where(eq(plugins.id, manifest.id))
      .run()
  } else {
    db.insert(plugins)
      .values({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? null,
        author: manifest.author ?? null,
        icon,
        main: manifest.main,
        manifest: JSON.stringify(manifest),
        permissions: JSON.stringify(manifest.permissions),
        daemon: manifest.daemon ? 1 : 0,
        enabled: 0,
        status: 'installed',
        config: '{}',
        installPath: dest,
        installedBy,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }
  return { id: manifest.id, name: manifest.name, version: manifest.version, replaced: Boolean(existing) }
}

/** Install from a `.zip` file on disk (extracts to a temp dir first). */
export async function installFromZipFile(db: Db, dataDir: string, zipPath: string, installedBy: string | null, beforeReplace?: BeforeReplace): Promise<InstallResult> {
  const AdmZip = await loadAdmZip()
  let zip: InstanceType<typeof AdmZipType>
  try {
    zip = new AdmZip(zipPath)
  } catch {
    throw new PluginInstallError('Not a valid .zip package')
  }
  return extractAndInstall(db, dataDir, zip, installedBy, beforeReplace)
}

/** Install from a zip provided as raw bytes (an uploaded file). */
export async function installFromZipBuffer(db: Db, dataDir: string, buffer: Buffer, installedBy: string | null, beforeReplace?: BeforeReplace): Promise<InstallResult> {
  const AdmZip = await loadAdmZip()
  let zip: InstanceType<typeof AdmZipType>
  try {
    zip = new AdmZip(buffer)
  } catch {
    throw new PluginInstallError('Not a valid .zip package')
  }
  return extractAndInstall(db, dataDir, zip, installedBy, beforeReplace)
}

/** Download a zip from a URL and install it. */
export async function installFromUrl(db: Db, dataDir: string, url: string, installedBy: string | null, beforeReplace?: BeforeReplace): Promise<InstallResult> {
  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch (e) {
    throw new PluginInstallError(`Could not download plugin: ${(e as Error).message}`)
  }
  if (!res.ok) throw new PluginInstallError(`Download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return installFromZipBuffer(db, dataDir, buf, installedBy, beforeReplace)
}

async function extractAndInstall(db: Db, dataDir: string, zip: InstanceType<typeof AdmZipType>, installedBy: string | null, beforeReplace?: BeforeReplace): Promise<InstallResult> {
  const tmp = mkdtempSync(join(tmpdir(), 'fw-plugin-'))
  try {
    zip.extractAllTo(tmp, /* overwrite */ true)
    return await installFromDirectory(db, dataDir, tmp, installedBy, beforeReplace)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Remove a plugin's files from disk (the DB row is deleted by the caller). Best-effort with a
 *  couple of retries — on Windows a just-exited child can briefly keep a handle on its dir. */
export function removePluginFiles(installPath: string): void {
  if (!installPath || !existsSync(installPath)) return
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      rmSync(installPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      return
    } catch {
      if (attempt === 2) return // give up silently; the row is already gone
    }
  }
}

/** Find the directory that actually contains plugin.json (root, or a single wrapper folder). */
function locateManifestDir(srcDir: string): string {
  if (existsSync(join(srcDir, 'plugin.json'))) return srcDir
  const entries = readdirSync(srcDir).filter((e) => !e.startsWith('.') && e !== '__MACOSX')
  if (entries.length === 1 && entries[0]) {
    const only = join(srcDir, entries[0])
    if (statSync(only).isDirectory() && existsSync(join(only, 'plugin.json'))) return only
  }
  throw new PluginInstallError('package does not contain a plugin.json')
}
