// Writes dist/build-info.json from the repo-root version, so the running bundle reports the
// version it was built/packaged at (survives self-updates, which swap the bundle + this file).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'package.json'), 'utf8'))
const out = join(process.cwd(), 'dist', 'build-info.json')
if (existsSync(join(process.cwd(), 'dist'))) {
  // builtAt is intentionally omitted here (kept stable across rebuilds); the release packager
  // stamps a real timestamp into the package's build-info.json.
  writeFileSync(out, JSON.stringify({ version: root.version }, null, 2))
  console.log(`build-info.json -> version ${root.version}`)
}
