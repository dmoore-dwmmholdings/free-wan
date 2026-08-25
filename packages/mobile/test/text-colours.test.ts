import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every colour this app writes text in has to be one that is readable on every preset.
 *
 * Checked by reading the source, because nothing else can see it. `tsc` is satisfied by any
 * string; the palette tests prove a *token* is readable but not that a readable one was the one
 * used; and there is no renderer here to point an accessibility auditor at, which is how the web
 * app catches this — see the axe flows in `e2e/z-a11y.spec.ts`.
 *
 * Three defects went in this way and were found one at a time by hand. The primary as the
 * current folder's name, at 3.87:1 on the default preset. The accent as the "Available offline"
 * label, at 3.44:1 on `linen`. And the error red on the Sign out button and every error message,
 * at 2.34:1 on `paper` — the worst in the app. Each survived because five or six of the seven
 * presets are comfortable and the default is one of them. This is the check that would have
 * caught all three at once.
 */

const dir = join(fileURLToPath(import.meta.url), '..')
const ROOTS = [join(dir, '..', 'src'), join(dir, '..', 'app')]

/**
 * Tokens whose contrast against both the background and a surface is asserted for every preset
 * elsewhere in this suite — see `palette.test.ts`. `onPrimary` is the odd one: it is never on
 * the background, only ever on the primary itself, and its contrast against that is asserted
 * there too.
 */
const READABLE = new Set(['text', 'muted', 'danger', 'primaryStrong', 'onPrimary'])

/**
 * Fixed colours, with the backdrop that makes each of them fine. Every one of these sits on
 * something this app painted rather than on the palette, so no preset can move it.
 */
const FIXED_ON_OWN_BACKDROP: Record<string, string> = {
  'MediaTile.tsx': 'white on the duration pill, which is a fixed 72% black over poster artwork',
  'PlaybackError.tsx': 'white on a fixed 85% black over the video frame',
  'Captions.tsx': 'white on a fixed 72% black plate over the video frame',
}

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

interface Use {
  file: string
  base: string
  line: number
  text: string
  tokens: string[]
  literals: string[]
}

/**
 * Every `color:` in a style object, and every navigator prop that paints text without going
 * through one.
 *
 * The second half was added after the first missed something a browser found immediately.
 * React Navigation's `tabBarActiveTintColor` colours the icon *and* the label with one value,
 * and the label is 11px — normal text, holding to 4.5:1. It was set to the raw primary, which
 * measures 3.55:1 against the bar on the default preset, and this file said nothing because the
 * colour never appears as a `color:` in a style. Every inactive label sat at 6.51:1 beside it.
 *
 * That is the third time a check here has missed the case that mattered by only understanding
 * the shape in front of it at the time. The lesson taken in `stubs.test.ts` applies: list the
 * props that paint text, and fail on one that is not recognised rather than passing in silence.
 */
const TEXT_PAINTING_PROPS = ['tabBarActiveTintColor', 'tabBarInactiveTintColor', 'headerTintColor']
function textColourUses(): Use[] {
  const uses: Use[] = []
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const base = file.split(/[\\/]/).pop()!
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((text, i) => {
          const prop = TEXT_PAINTING_PROPS.find((p) => text.includes(`${p}:`))
          const at = prop ? text.indexOf(`${prop}:`) + prop.length + 1 : text.indexOf('color:')
          if (!prop && text.indexOf('color:') === -1) return
          const value = prop ? text.slice(at) : text.slice(at + 'color:'.length)
          uses.push({
            file: file.replace(/.*packages./, 'packages/'),
            base,
            line: i + 1,
            text: text.trim(),
            tokens: [...value.matchAll(/theme\.color\.(\w+)/g)].map((m) => m[1]!),
            literals: [...value.matchAll(/['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))['"]/g)].map((m) => m[1]!),
          })
        })
    }
  }
  return uses
}

describe('the colours this app writes text in', () => {
  const uses = textColourUses()

  it('finds them, so the checks below are not vacuous', () => {
    // If the scan silently returned nothing this would all pass having read nothing at all.
    expect(uses.length).toBeGreaterThan(30)
    expect(uses.some((u) => u.tokens.includes('text'))).toBe(true)
  })

  it('only ever uses a token proven readable on every preset', () => {
    const bad = uses
      .flatMap((u) => u.tokens.map((token) => ({ ...u, token })))
      .filter((u) => !READABLE.has(u.token))
      .map((u) => `${u.file}:${u.line} writes text in theme.color.${u.token} — ${u.text}`)
    expect(bad).toEqual([])
  })

  it('only writes a fixed colour where the app also fixed what is behind it', () => {
    const bad = uses
      .filter((u) => u.literals.length > 0 && !(u.base in FIXED_ON_OWN_BACKDROP))
      .map((u) => `${u.file}:${u.line} writes text in ${u.literals.join(', ')} — ${u.text}`)
    expect(bad).toEqual([])
  })

  it('names a backdrop for every file allowed a fixed colour', () => {
    // An exemption with nothing behind it is how a list like this stops meaning anything.
    for (const [base, why] of Object.entries(FIXED_ON_OWN_BACKDROP)) {
      expect(uses.some((u) => u.base === base && u.literals.length > 0), `${base} no longer needs its exemption`).toBe(true)
      expect(why.length).toBeGreaterThan(20)
    }
  })
})
