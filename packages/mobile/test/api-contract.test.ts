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
 * Paths this app requests. A `${...}` hole is a path parameter when it follows a slash, and a
 * query string when it does not — `/api/categories${qs}` builds `/api/categories?parent=…`.
 */
function requestedPaths(): Map<string, string> {
  const found = new Map<string, string>()
  for (const root of MOBILE) {
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/[`'](\/api\/[^`'\s]*)[`']/g)) {
        const raw = m[1]!
        let path = raw.replace(/\/\$\{[^}]*\}/g, '/:param').replace(/\$\{[^}]*\}$/, '')
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
