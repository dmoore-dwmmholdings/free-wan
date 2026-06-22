// File classification & ignore rules (media pipeline §1). Extension lists mirror the
// spec; these could later be made config-driven.

export const VIDEO_EXTS = new Set([
  'mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'ts', 'm2ts', 'mpg', 'mpeg', 'ogv',
])
export const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'bmp', 'tiff',
])
export const SUBTITLE_EXTS = new Set(['srt', 'vtt', 'ass', 'ssa', 'sub'])

export type MediaKind = 'video' | 'image'

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** Filename without its extension. */
export function stemOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export function classify(name: string): MediaKind | null {
  const e = extOf(name)
  if (VIDEO_EXTS.has(e)) return 'video'
  if (IMAGE_EXTS.has(e)) return 'image'
  return null
}

export function isSubtitle(name: string): boolean {
  return SUBTITLE_EXTS.has(extOf(name))
}

const IGNORE_NAMES = new Set(['.ds_store', 'thumbs.db', '@eadir'])
const IGNORE_EXTS = new Set(['part', 'crdownload', 'tmp'])

/** True for hidden files, junk, and partial downloads (media pipeline §1). */
export function isIgnored(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.startsWith('.')) return true
  if (IGNORE_NAMES.has(lower)) return true
  if (IGNORE_EXTS.has(extOf(name))) return true
  return false
}

/** Human title derived from a filename: drop ext, turn separators into spaces. */
export function titleFromFilename(name: string): string {
  const base = stemOf(name)
  const cleaned = base.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || name
}
