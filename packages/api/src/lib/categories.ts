// Folder → category derivation (media pipeline §4). Pure and side-effect free so it is
// trivially testable; the scanner upserts these nodes and links items to the whole chain.

export interface CategoryNode {
  /** Single folder segment (display case from the path). */
  name: string
  /** Cumulative slash-joined path from the repo root, e.g. "Movies/Action". */
  path: string
  /** 0-based depth. */
  depth: number
}

export const MAX_CATEGORY_DEPTH = 12

/**
 * Given an item's repo-relative path, return the chain of category nodes for its
 * directory segments (the filename is excluded). Collapses repeated separators,
 * trims whitespace, and caps depth.
 */
export function deriveCategoryChain(relPath: string, maxDepth = MAX_CATEGORY_DEPTH): CategoryNode[] {
  const parts = relPath
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (parts.length <= 1) return [] // file sits at the repo root → no category

  const dirs = parts.slice(0, -1).slice(0, maxDepth)
  const nodes: CategoryNode[] = []
  let cumulative = ''
  dirs.forEach((name, i) => {
    cumulative = cumulative ? `${cumulative}/${name}` : name
    nodes.push({ name, path: cumulative, depth: i })
  })
  return nodes
}
