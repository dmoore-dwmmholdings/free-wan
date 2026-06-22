import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/**
 * Resolve an untrusted repo-relative path and assert it stays inside the repository root
 * (security §4). Resolves symlinks via realpath; throws on traversal, symlink-escape,
 * absolute-path injection, or a missing target. The returned path is canonical and safe
 * to open.
 */
export function resolveWithinRoot(root: string, relPath: string): string {
  const canonicalRoot = realpathSync(root)
  // resolve() collapses `..` and lets an absolute `relPath` override the root — both are
  // caught by the prefix check below.
  const candidate = resolve(canonicalRoot, relPath)
  const real = realpathSync(candidate)
  const rootWithSep = canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep
  if (real !== canonicalRoot && !real.startsWith(rootWithSep)) {
    throw new Error('path escapes repository root')
  }
  return real
}
