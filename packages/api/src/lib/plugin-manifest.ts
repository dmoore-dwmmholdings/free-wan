import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pluginManifestSchema, type PluginManifest } from '@free-wan/shared'
import { sanitizeSvg } from './sanitize-svg'

export interface LoadedManifest {
  manifest: PluginManifest
  /** Absolute path to the entry module, asserted to live inside the plugin dir. */
  mainPath: string
  /** Sanitized inline SVG icon, or null. */
  icon: string | null
}

/** Read and validate `plugin.json` from a plugin directory; resolve + confine the entry path. */
export function loadManifest(dir: string): LoadedManifest {
  const manifestPath = join(dir, 'plugin.json')
  if (!existsSync(manifestPath)) {
    throw new Error('plugin.json not found in package')
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    throw new Error(`plugin.json is not valid JSON: ${(e as Error).message}`)
  }
  const parsed = pluginManifestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`invalid plugin.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  const manifest = parsed.data

  // The entry must resolve within the plugin dir (no absolute paths, no `..` escape).
  const root = resolve(dir)
  const mainPath = resolve(root, manifest.main)
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (!mainPath.startsWith(rootWithSep)) {
    throw new Error('manifest "main" escapes the plugin directory')
  }
  if (!existsSync(mainPath) || !statSync(mainPath).isFile()) {
    throw new Error(`manifest "main" (${manifest.main}) does not point at a file`)
  }

  const icon = manifest.icon ? sanitizeSvg(manifest.icon) : null
  return { manifest, mainPath, icon }
}
