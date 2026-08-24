import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every `Pressable` either says what it is, or says it is not an element at all.
 *
 * React Native makes a `Pressable` an accessibility element unless told otherwise, and an
 * element's name is built from its children when it is not given one. That produces two
 * failures, and this app has had both. A row of an image, a title and a size announced as
 * "Big Buck Bunny0:33 · 120 MB" and never said it was a link — which is what the Downloads tab
 * did, alone among the four screens that list things. And a modal backdrop that *is* an element
 * swallows the sheet inside it, leaving a screen reader one unlabelled blob and no way to reach
 * the options, which is why the sheets opt out explicitly.
 *
 * Read from the source because there is no renderer here. The web app gets this from axe.
 */

const dir = join(fileURLToPath(import.meta.url), '..')
const ROOTS = [join(dir, '..', 'src'), join(dir, '..', 'app')]

function sourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx$/.test(entry)) out.push(full)
    }
  }
  walk(root)
  return out
}

/**
 * The text of one JSX opening tag, from `<Pressable` to the `>` that closes it.
 *
 * Scanned rather than matched with an expression, and for the same reason the API-contract test
 * scans: the props hold arbitrary JavaScript. A style is an arrow function returning an object
 * literal, several hold template strings and ternaries, and any of those can contain a `>` — a
 * fat arrow is one. Counting brace depth is what keeps `({ pressed }) => ({ ... })` from ending
 * the tag three times over.
 */
function openingTag(src: string, start: number): string {
  let depth = 0
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i]!
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    else if (ch === '>' && depth === 0 && src[i - 1] !== '=') return src.slice(start, i + 1)
  }
  return src.slice(start)
}

interface Tag {
  file: string
  line: number
  props: string
}

function pressables(): Tag[] {
  const found: Tag[] = []
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/<Pressable\b/g)) {
        found.push({
          file: file.replace(/.*packages./, 'packages/'),
          line: src.slice(0, m.index).split('\n').length,
          props: openingTag(src, m.index),
        })
      }
    }
  }
  return found
}

describe('every Pressable in the app', () => {
  const tags = pressables()

  it('finds them, so the check below is not vacuous', () => {
    expect(tags.length).toBeGreaterThan(20)
    // And the scan reaches the end of a tag rather than stopping at the first `>` inside a
    // style function, which would make every check below read almost nothing.
    expect(tags.some((t) => t.props.includes('accessibilityRole'))).toBe(true)
    expect(tags.every((t) => t.props.trimEnd().endsWith('>'))).toBe(true)
  })

  it('either says what it is or says it is not an element', () => {
    const silent = tags
      .filter((t) => !t.props.includes('accessibilityRole') && !t.props.includes('accessible={false}'))
      .map((t) => `${t.file}:${t.line} is a Pressable with no accessibilityRole and no opt-out`)
    expect(silent).toEqual([])
  })

  it('names itself wherever its children would not', () => {
    // An icon is a `Text` holding a character from a private-use area, which reads as nothing,
    // so any Pressable containing one has to carry its own name. The exceptions are the ones
    // whose only child is a plain `Text` saying exactly what the control does — a name there
    // would be the same words twice. Listed by file rather than counted, so a seventh has to
    // be looked at and added on purpose instead of slipping under a number.
    const namedByTheirOwnWords = new Set([
      'ErrorState.tsx', // "Try again"
      'PlaybackError.tsx', // "Try again"
      'change-password.tsx', // "Change password"
      'login.tsx', // "Sign in"
      'settings.tsx', // "Sign out"
      '[id].tsx', // "Download failed — tap to try again", plus the server's reason
    ])
    const unnamed = tags
      .filter((t) => t.props.includes('accessibilityRole'))
      .filter((t) => !t.props.includes('accessibilityLabel'))
      .filter((t) => !namedByTheirOwnWords.has(t.file.split(/[\\/]/).pop()!))
      .map((t) => `${t.file}:${t.line} has a role but no label, and its children may not read`)
    expect(unnamed).toEqual([])
  })
})
