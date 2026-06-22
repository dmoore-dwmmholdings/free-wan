import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { applyPackage, validatePackage, rollbackLatest, readPending, UpdateError, type UpdatePaths } from '../src/services/updater'

const sha256 = (s: string) => createHash('sha256').update(Buffer.from(s)).digest('hex')

interface PkgOpts {
  version?: string
  indexJs?: string
  indexHtml?: string
  formatVersion?: number
  omitWeb?: boolean
  badChecksum?: boolean
}

function makePackage(zipPath: string, o: PkgOpts = {}): void {
  const version = o.version ?? '0.2.0'
  const indexJs = o.indexJs ?? 'NEW-API'
  const indexHtml = o.indexHtml ?? 'NEW-WEB'
  const zip = new AdmZip()
  zip.addFile('api/dist/index.js', Buffer.from(indexJs))
  zip.addFile('api/migrations/0000_init.sql', Buffer.from('CREATE TABLE x(a);'))
  zip.addFile('api/migrations/0001_new.sql', Buffer.from('CREATE TABLE y(b);'))
  if (!o.omitWeb) zip.addFile('web/dist/index.html', Buffer.from(indexHtml))
  const manifest = {
    formatVersion: o.formatVersion ?? 1,
    name: 'free-wan',
    version,
    changelog: `Release ${version}`,
    sha256: {
      'api/dist/index.js': o.badChecksum ? 'deadbeef' : sha256(indexJs),
      ...(o.omitWeb ? {} : { 'web/dist/index.html': sha256(indexHtml) }),
    },
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
  zip.writeZip(zipPath)
}

describe('self-update (updater service)', () => {
  let tmp: string
  let paths: UpdatePaths
  let dataSentinel: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fw-upd-'))
    const install = join(tmp, 'install')
    paths = {
      apiDist: join(install, 'packages', 'api', 'dist'),
      apiMigrations: join(install, 'packages', 'api', 'migrations'),
      webDist: join(install, 'packages', 'web', 'dist'),
      work: join(install, '.fw-update'),
    }
    // Seed the "current" install.
    mkdirSync(paths.apiDist, { recursive: true })
    mkdirSync(paths.apiMigrations, { recursive: true })
    mkdirSync(paths.webDist, { recursive: true })
    writeFileSync(join(paths.apiDist, 'index.js'), 'OLD-API')
    writeFileSync(join(paths.apiMigrations, '0000_init.sql'), 'CREATE TABLE x(a);')
    writeFileSync(join(paths.webDist, 'index.html'), 'OLD-WEB')
    // A separate DATA_DIR with a sentinel that must never be touched by an update.
    dataSentinel = join(tmp, 'data', 'free-wan.db')
    mkdirSync(join(tmp, 'data'), { recursive: true })
    writeFileSync(dataSentinel, 'PRECIOUS-DB')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('applies a package: swaps code, backs up the old code, leaves DATA_DIR untouched', async () => {
    const zip = join(tmp, 'pkg.zip')
    makePackage(zip, { version: '0.2.0' })
    const res = await applyPackage(zip, paths)

    expect(res.version).toBe('0.2.0')
    expect(readFileSync(join(paths.apiDist, 'index.js'), 'utf8')).toBe('NEW-API')
    expect(readFileSync(join(paths.webDist, 'index.html'), 'utf8')).toBe('NEW-WEB')
    expect(existsSync(join(paths.apiMigrations, '0001_new.sql'))).toBe(true)

    // Backup of the old code exists.
    const backups = readdirSync(join(paths.work, 'backups'))
    expect(backups.length).toBe(1)
    expect(readFileSync(join(paths.work, 'backups', backups[0]!, 'api-dist', 'index.js'), 'utf8')).toBe('OLD-API')

    // Pending marker written for the supervisor.
    expect(readPending(paths)?.version).toBe('0.2.0')

    // DATA_DIR is completely untouched.
    expect(readFileSync(dataSentinel, 'utf8')).toBe('PRECIOUS-DB')
  })

  it('rejects an unsupported format without changing anything', async () => {
    const zip = join(tmp, 'bad.zip')
    makePackage(zip, { formatVersion: 2 })
    await expect(applyPackage(zip, paths)).rejects.toBeInstanceOf(UpdateError)
    expect(readFileSync(join(paths.apiDist, 'index.js'), 'utf8')).toBe('OLD-API') // untouched
  })

  it('rejects a checksum mismatch without changing anything', async () => {
    const zip = join(tmp, 'tampered.zip')
    makePackage(zip, { badChecksum: true })
    await expect(applyPackage(zip, paths)).rejects.toThrow(/checksum/i)
    expect(readFileSync(join(paths.apiDist, 'index.js'), 'utf8')).toBe('OLD-API')
  })

  it('rejects a package missing the web build', async () => {
    const zip = join(tmp, 'noweb.zip')
    makePackage(zip, { omitWeb: true })
    await expect(validatePackage(zip)).rejects.toThrow(/web\/dist\/index\.html/)
  })

  it('rolls back to the previous version', async () => {
    const zip = join(tmp, 'pkg.zip')
    makePackage(zip, { version: '0.2.0' })
    await applyPackage(zip, paths)
    expect(readFileSync(join(paths.apiDist, 'index.js'), 'utf8')).toBe('NEW-API')

    await rollbackLatest(paths)
    expect(readFileSync(join(paths.apiDist, 'index.js'), 'utf8')).toBe('OLD-API')
    expect(readFileSync(join(paths.webDist, 'index.html'), 'utf8')).toBe('OLD-WEB')
    expect(readPending(paths)).toBeNull()
  })
})
