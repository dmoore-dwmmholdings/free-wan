// Build a deployable Free-WAN update package: release/free-wan-<version>.zip
// Run via `pnpm package` (which builds first). Code-only: bundles the API build, migrations,
// and web build — node_modules and DATA_DIR are intentionally excluded.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(repoRoot, 'packages', 'api', 'package.json'))
const AdmZip = require('adm-zip')

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const version = pkg.version
const builtAt = new Date().toISOString()

const apiDist = join(repoRoot, 'packages', 'api', 'dist')
const apiMigrations = join(repoRoot, 'packages', 'api', 'migrations')
// The plugin host runtime is a standalone .mjs (not bundled by tsup); it must ship beside the
// bundle so forked plugin processes can be launched in production (docs/13-plugins.md).
const apiRuntime = join(repoRoot, 'packages', 'api', 'runtime')
const webDist = join(repoRoot, 'packages', 'web', 'dist')
for (const [label, p] of [['api/dist', apiDist], ['api/migrations', apiMigrations], ['api/runtime', apiRuntime], ['web/dist', webDist]]) {
  if (!existsSync(p)) {
    console.error(`Missing ${label} (${p}). Run "pnpm -r build" first.`)
    process.exit(1)
  }
}

// Pull the changelog section for this version from CHANGELOG.md (heading containing the version).
function changelogFor(v) {
  const file = join(repoRoot, 'CHANGELOG.md')
  if (!existsSync(file)) return `Release ${v}`
  const text = readFileSync(file, 'utf8')
  const sections = text.split(/^## /m).slice(1)
  const hit = sections.find((s) => s.split('\n')[0].includes(v))
  return hit ? `## ${hit}`.trim() : `Release ${v}`
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const zip = new AdmZip()
const buildInfo = Buffer.from(JSON.stringify({ version, builtAt }, null, 2))

// build-info.json ships at the package root AND beside the bundle (runtime version source).
zip.addFile('build-info.json', buildInfo)
zip.addFile('api/dist/build-info.json', buildInfo)
zip.addLocalFile(join(apiDist, 'index.js'), 'api/dist')
if (existsSync(join(apiDist, 'index.js.map'))) zip.addLocalFile(join(apiDist, 'index.js.map'), 'api/dist')
zip.addLocalFolder(apiMigrations, 'api/migrations')
zip.addLocalFolder(apiRuntime, 'api/runtime')
zip.addLocalFolder(webDist, 'web/dist')

const manifest = {
  formatVersion: 1,
  name: 'free-wan',
  version,
  builtAt,
  changelog: changelogFor(version),
  sha256: {
    'api/dist/index.js': sha256(readFileSync(join(apiDist, 'index.js'))),
    'web/dist/index.html': sha256(readFileSync(join(webDist, 'index.html'))),
  },
}
zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))

const outDir = join(repoRoot, 'release')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, `free-wan-${version}.zip`)
zip.writeZip(outPath)
console.log(`Packaged v${version} -> ${outPath}`)
