// Free-WAN supervisor: runs the API and relaunches it after a self-update, with crash-loop
// auto-rollback. It is the `start` entrypoint of the @free-wan/api package, so it deploys with
// the app (no separate top-level folder required).
//
// Child exit codes:
//   0   -> graceful stop (we exit too)
//   75  -> update applied; relaunch with the new code
//   else-> crash; relaunch with backoff. If a just-applied update crash-loops, roll it back.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, renameSync, cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPDATE_RESTART_CODE = 75
const apiDir = dirname(fileURLToPath(import.meta.url)) // packages/api
const webDir = join(apiDir, '..', 'web')
const repoRoot = join(apiDir, '..', '..')
const work = join(repoRoot, '.fw-update')
const pendingFile = join(work, 'pending.json')

function log(msg) {
  process.stdout.write(`[supervisor] ${msg}\n`)
}

function moveDir(src, dest) {
  if (!existsSync(src)) return
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  try {
    renameSync(src, dest)
  } catch {
    cpSync(src, dest, { recursive: true })
    rmSync(src, { recursive: true, force: true })
  }
}

function readPending() {
  if (!existsSync(pendingFile)) return null
  try {
    return JSON.parse(readFileSync(pendingFile, 'utf8'))
  } catch {
    return null
  }
}

function rollback() {
  const pending = readPending()
  const backupDir = pending?.backupDir
  if (!backupDir || !existsSync(backupDir)) {
    log('no usable backup to roll back to')
    rmSync(pendingFile, { force: true })
    return false
  }
  log(`rolling back failed update -> restoring ${backupDir}`)
  moveDir(join(backupDir, 'api-dist'), join(apiDir, 'dist'))
  moveDir(join(backupDir, 'api-migrations'), join(apiDir, 'migrations'))
  moveDir(join(backupDir, 'web-dist'), join(webDir, 'dist'))
  rmSync(pendingFile, { force: true })
  return true
}

let earlyCrashes = 0
let stopping = false
let child = null

function start() {
  child = spawn(process.execPath, ['dist/index.js'], {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, FW_SUPERVISED: '1' },
  })
  const startedAt = Date.now()

  child.on('exit', (code) => {
    child = null
    if (stopping || code === 0) {
      log('server stopped')
      process.exit(0)
    }
    if (code === UPDATE_RESTART_CODE) {
      log('update applied — relaunching')
      earlyCrashes = 0
      return start()
    }
    // Crash.
    earlyCrashes = Date.now() - startedAt < 10_000 ? earlyCrashes + 1 : 0
    if (earlyCrashes >= 3 && readPending()) {
      if (rollback()) earlyCrashes = 0
      return start()
    }
    log(`server exited with code ${code}; restarting in 2s`)
    setTimeout(start, 2000)
  })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true
    if (child) child.kill(sig)
  })
}

if (!existsSync(join(apiDir, 'dist', 'index.js'))) {
  log(`built server not found at ${join(apiDir, 'dist', 'index.js')} — run "pnpm -r build" first`)
  process.exit(1)
}
log('starting Free-WAN')
start()
