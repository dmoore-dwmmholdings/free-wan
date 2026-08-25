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
    const ns = new RegExp(`import\\s*\\*\\s*as\\s+(\\w+)\\s*from\\s*['"]${pkg.replace(/[/\\]/g, '\\$&')}['"]`)
    const bound = ns.exec(src)?.[1]
    if (bound) {
      for (const m of src.matchAll(new RegExp(`\\b${bound}\\.(\\w+)`, 'g'))) {
        found.push({ name: m[1]!, file: file.replace(/.*packages./, 'packages/') })
      }
    }
  }
  return found
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
