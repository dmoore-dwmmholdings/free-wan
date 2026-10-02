import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every name the tested code imports from a stubbed package has to exist in the stub.
 *
 * A missing one does not fail. ESM through Vite hands the importer `undefined` and carries on,
 * so the module loads, the suite passes, and the gap shows up only when something finally calls
 * through it. That happened here: `progress.ts` started importing `AppState` from `react-native`
 * and the stub had only `Appearance`. Nothing broke, because the sole user is a hook and there
 * is no renderer in this package to call it — so the report was green while a name the
 * production code depends on was quietly nothing.
 *
 * Scoped to `src/lib`, which is what the tests actually load. The components import half of
 * React Native, and demanding a stub for all of it would be asking for a second React Native.
 */

const dir = join(fileURLToPath(import.meta.url), '..')
const LIB = join(dir, '..', 'src', 'lib')
const STUBS = join(dir, 'stubs')

/** Aliased in `vitest.config.ts`. The key is the import specifier, the value the stub file. */
const STUBBED: Record<string, string> = {
  'react-native': 'react-native.ts',
  'expo-secure-store': 'expo-secure-store.ts',
  'expo-file-system/legacy': 'expo-file-system.ts',
  '@react-native-async-storage/async-storage': 'async-storage.ts',
}

function libFiles(): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.ts$/.test(entry)) out.push(full)
    }
  }
  walk(LIB)
  return out
}

/**
 * The names imported from `pkg` across the library, excluding `type` ones — a type is erased
 * before anything runs, so a stub owes it nothing.
 */
function namesImportedFrom(pkg: string): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = []
  for (const file of libFiles()) {
    const src = readFileSync(file, 'utf8')
    const pattern = new RegExp(`import\\s*{([^}]*)}\\s*from\\s*['"]${pkg.replace(/[/\\]/g, '\\$&')}['"]`, 'g')
    for (const m of src.matchAll(pattern)) {
      for (const raw of m[1]!.split(',')) {
        const clean = raw.trim()
        if (!clean || clean.startsWith('type ')) continue
        // `x as y` imports x.
        found.push({ name: clean.split(/\s+as\s+/)[0]!.trim(), file: file.replace(/.*packages./, 'packages/') })
      }
    }
    // A namespace import needs the same check, by a different route. `import * as FileSystem`
    // binds an object, so a member the stub lacks is `undefined` at the call site rather than
    // an error at load — which is how `createUploadTask` and `FileSystemUploadType` went
    // missing from the filesystem stub without anything failing. Nothing had ever called
    // `uploadFile`, so nothing ever reached them.
    const quoted = pkg.replace(/[/\\]/g, '\\$&')
    const ns = new RegExp(`import\\s*\\*\\s*as\\s+(\\w+)\\s*from\\s*['"]${quoted}['"]`)
    const bound = ns.exec(src)?.[1]
    if (bound) {
      for (const m of src.matchAll(new RegExp(`\\b${bound}\\.(\\w+)`, 'g'))) {
        found.push({ name: m[1]!, file: file.replace(/.*packages./, 'packages/') })
      }
    }
  }
  return found
}

/**
 * The members reached through a default import, which is a third way to arrive at `undefined`
 * quietly. `AsyncStorage.getItem` on a default export the stub happens not to have reads exactly
 * like the other two — and this check was written twice before covering it, first for named
 * imports only and then for named and namespace. Each time the form left out was the one that
 * was actually wrong.
 */
function defaultMembersFrom(pkg: string): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = []
  const quoted = pkg.replace(/[/\\]/g, '\\$&')
  for (const file of libFiles()) {
    const src = readFileSync(file, 'utf8')
    const bound = new RegExp(`import\\s+(\\w+)\\s*from\\s*['"]${quoted}['"]`).exec(src)?.[1]
    if (!bound) continue
    for (const m of src.matchAll(new RegExp(`\\b${bound}\\.(\\w+)`, 'g'))) {
      found.push({ name: m[1]!, file: file.replace(/.*packages./, 'packages/') })
    }
  }
  return found
}

/**
 * The import forms above, recognised. Anything else that pulls one of these packages in is not
 * checked by this file, and the point of listing them is that it should say so out loud.
 *
 * This check exists because the same mistake has now been made three times running: the file was
 * written for named imports, missed the namespace form and let `createUploadTask` go absent for
 * the life of the upload feature; it was then extended to namespaces and still did not cover
 * default imports. Each round, the form left out was the one that mattered. A fourth form —
 * `import X, { a } from 'pkg'` — is matched by none of the three parsers, and rather than write
 * a fourth parser and hope that is the last of them, an unrecognised statement now fails.
 */
function importStatements(pkg: string): string[] {
  const quoted = pkg.replace(/[/\\]/g, '\\$&')
  const any = new RegExp(`^.*(?:import|require)\\s*\\(?[^\\n]*['"]${quoted}['"].*$`, 'gm')
  return libFiles().flatMap((file) => [...readFileSync(file, 'utf8').matchAll(any)].map((m) => m[0]!.trim()))
}

describe('the stubs that stand in for what cannot load under Node', () => {
  it('finds imports to check, so this is not vacuous', () => {
    const all = Object.keys(STUBBED).flatMap((pkg) => namesImportedFrom(pkg))
    expect(all.length).toBeGreaterThan(2)
    expect(all.some((u) => u.name === 'Appearance')).toBe(true)
  })

  it.each(Object.entries(STUBBED))('%s provides everything src/lib imports from it', async (pkg, stubFile) => {
    const wanted = namesImportedFrom(pkg)
    if (wanted.length === 0) return
    const stub = (await import(join(STUBS, stubFile))) as Record<string, unknown>
    const missing = wanted
      .filter((w) => !(w.name in stub))
      .map((w) => `${pkg} stub has no ${w.name}, imported by ${w.file}`)
    expect(missing).toEqual([])
  })

  it.each(Object.entries(STUBBED))('%s default export provides what src/lib calls on it', async (pkg, stubFile) => {
    const wanted = defaultMembersFrom(pkg)
    if (wanted.length === 0) return
    const mod = (await import(join(STUBS, stubFile))) as { default?: Record<string, unknown> }
    const fallback = mod.default ?? {}
    const missing = wanted
      .filter((w) => !(w.name in fallback) || fallback[w.name] === undefined)
      .map((w) => `${pkg} default export has no ${w.name}, called by ${w.file}`)
    expect(missing).toEqual([])
  })

  it('recognises every way these packages are imported', () => {
    // Not "every form is handled" — "no form is silently skipped". If this fails, the statement
    // it names needs a parser above, not an exemption here.
    const RECOGNISED = [
      /^import\s*{[^}]*}\s*from/, // named
      /^import\s*\*\s*as\s+\w+\s*from/, // namespace
      /^import\s+\w+\s*from/, // default
      /^import\s+type\b/, // types only — erased before anything runs
    ]
    const unrecognised = Object.keys(STUBBED).flatMap((pkg) =>
      importStatements(pkg)
        .filter((line) => !RECOGNISED.some((re) => re.test(line)))
        .map((line) => `${pkg}: this file does not know how to check "${line}"`),
    )
    expect(unrecognised).toEqual([])
  })

  it('does not hand anything over as undefined', async () => {
    // A name can be present and still be nothing, which reads to the code using it exactly as
    // being absent does — which is the whole failure this file is about.
    const nothing: string[] = []
    for (const [pkg, stubFile] of Object.entries(STUBBED)) {
      const stub = (await import(join(STUBS, stubFile))) as Record<string, unknown>
      for (const { name } of namesImportedFrom(pkg)) {
        if (name in stub && stub[name] === undefined) nothing.push(`${pkg}.${name}`)
      }
    }
    expect(nothing).toEqual([])
  })
})
