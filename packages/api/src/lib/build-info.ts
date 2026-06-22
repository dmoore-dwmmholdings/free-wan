import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface BuildInfo {
  version: string
  builtAt?: string
}

/**
 * The deployed version, resolved in order from:
 *  1. `build-info.json` beside the running bundle (written at build/package time) — this is the
 *     source of truth after a self-update, since the package swaps the bundle + its build-info.
 *  2. the nearest `free-wan` root package.json (covers dev / unpackaged runs),
 *  3. `npm_package_version`, else a hardcoded fallback.
 */
export function readBuildInfo(): BuildInfo {
  const dir = dirname(fileURLToPath(import.meta.url)) // prod: packages/api/dist ; dev: packages/api/src/lib

  const beside = join(dir, 'build-info.json')
  if (existsSync(beside)) {
    try {
      const j = JSON.parse(readFileSync(beside, 'utf8')) as Partial<BuildInfo>
      if (j.version) return { version: j.version, builtAt: j.builtAt }
    } catch {
      /* fall through */
    }
  }

  let cur = dir
  for (let i = 0; i < 6; i++) {
    const pkg = join(cur, 'package.json')
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string; version?: string }
        if (j.name === 'free-wan' && j.version) return { version: j.version }
      } catch {
        /* ignore */
      }
    }
    cur = dirname(cur)
  }

  return { version: process.env.npm_package_version ?? '0.1.0' }
}
