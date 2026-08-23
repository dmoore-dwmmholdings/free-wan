import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every `/api/...` path this app asks for has to exist on the server.
 *
 * This is checked because it has already gone wrong: an earlier version called
 * `GET /api/collections/:id`, an endpoint that was never written, and nothing caught it until
 * the screen 404'd on a device. `tsc` cannot see it — a URL is just a string — and the unit
 * tests stub `fetch`, so they cannot either. Reading both sides of the contract is the only
 * check that runs without a server.
 */

const dir = join(fileURLToPath(import.meta.url), '..')
const MOBILE = [join(dir, '..', 'src'), join(dir, '..', 'app')]
const API_ROUTES = join(dir, '..', '..', 'api', 'src', 'routes')

function sourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
  }
  walk(root)
  return out
}

/** Paths registered with Fastify, e.g. `app.get('/api/media/:id', ...)`. */
function registeredRoutes(): string[] {
  const routes = new Set<string>()
  for (const file of sourceFiles(API_ROUTES)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']*)'/g)) {
      routes.add(m[2]!)
    }
  }
  return [...routes]
}

/**
 * Read one path literal out of `src`, starting at the `/api/` at `start`, and stop at the
 * quote or backtick that closes it. Each `${...}` hole becomes the marker `${}`.
 *
 * This is a scan rather than a regular expression because a hole can contain anything —
 * including a space, and including a nested template literal with backticks of its own:
 *
 *     `/api/media/${id}/raw${w ? `?w=${w}` : ''}`
 *
 * The expression this replaced stopped at the first space or backtick, so a path written that
 * way matched nothing at all and was passed over in silence. That is the one outcome this
 * whole test exists to prevent, and it had already happened once before anyone noticed.
 */
function readPathLiteral(src: string, start: number): string {
  let out = ''
  let i = start
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '$' && src[i + 1] === '{') {
      // Walk to the brace that closes the hole, counting depth so a nested template inside it
      // cannot end it early.
      let depth = 0
      let j = i + 1
      for (; j < src.length; j += 1) {
        if (src[j] === '{') depth += 1
        else if (src[j] === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      out += '${}'
      i = j + 1
      continue
    }
    // A path literal never runs past the line it starts on, so a newline ends it too.
    if (/[`'"\n]/.test(ch)) break
    out += ch
    i += 1
  }
  return out
}

/**
 * Paths this app requests. A `${...}` hole is a path parameter when it follows a slash, and a
 * query string when it does not — `/api/categories${qs}` builds `/api/categories?parent=…`.
 */
function requestedPaths(): Map<string, string> {
  const found = new Map<string, string>()
  for (const root of MOBILE) {
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/[`'"](?=\/api\/)/g)) {
        const raw = readPathLiteral(src, m.index + 1)
        let path = raw.replace(/\/\$\{\}/g, '/:param').replace(/\$\{\}$/, '')
        path = path.split('?')[0]!.replace(/\/$/, '')
        // Anything still carrying a hole is built in a way this check cannot read; that is a
        // reason to fail rather than to skip, so it is left in and will not match.
        if (!found.has(path)) found.set(path, file.replace(/.*packages./, 'packages/'))
      }
    }
  }
  return found
}

function isServedBy(path: string, route: string): boolean {
  const a = path.split('/').filter(Boolean)
  const b = route.split('/').filter(Boolean)
  if (a.length !== b.length) return false
  return a.every((seg, i) => {
    const want = b[i]!
    if (want.startsWith(':')) return true
    // A trailing literal after a parameter, as in `:trackId.vtt`.
    if (want.includes(':')) return true
    return seg === want
  })
}

describe('the API contract between this app and the server', () => {
  const routes = registeredRoutes()
  const requested = requestedPaths()

  it('finds both sides of the contract', () => {
    // If either extraction silently returns nothing the checks below pass vacuously, which
    // would be worse than no test at all.
    expect(routes.length).toBeGreaterThan(30)
    expect(requested.size).toBeGreaterThan(10)
  })

  it.each([...requestedPaths().keys()].sort())('the server serves %s', (path) => {
    const match = routes.find((r) => isServedBy(path, r))
    expect(match, `${path} is requested by ${requested.get(path)} but no route matches it`).toBeDefined()
  })
})
