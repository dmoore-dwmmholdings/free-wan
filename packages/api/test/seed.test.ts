import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'

const fakeProber: Prober = async () => ({
  durationS: 60,
  width: 1280,
  height: 720,
  container: 'mov,mp4,m4a',
  videoCodec: 'h264',
  audioCodec: 'aac',
  audioTracks: 1,
  embeddedSubs: [],
})

async function adminCookies(app: FastifyInstance): Promise<Record<string, string>> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'admin-pass-123' },
  })
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!
  return { [SESSION_COOKIE]: c.value }
}

describe('first-run repository seeding (config/repositories.yaml)', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!()
  })

  async function makeTmp(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'fw-seed-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    return dir
  }

  it('seeds valid entries on first run, skips missing paths, and scans', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'movies'))
    await writeFile(join(tmp, 'movies', 'a.mp4'), 'x')
    const seedFile = join(tmp, 'repositories.yaml')
    await writeFile(
      seedFile,
      [
        'repositories:',
        '  - name: Movies',
        `    path: ${JSON.stringify(join(tmp, 'movies'))}`,
        '    type: video',
        '  - name: Ghost',
        `    path: ${JSON.stringify(join(tmp, 'nope'))}`,
      ].join('\n'),
    )

    const app = await buildApp(
      {
        env: 'test',
        dataDir: ':memory:',
        adminUsername: 'admin',
        adminPassword: 'admin-pass-123',
        loginRateMax: 1000,
        repositoriesFile: seedFile,
      },
      { prober: fakeProber },
    )
    cleanups.push(() => app.close())
    await app.ready()
    await app.worker.onIdle()

    const res = await app.inject({ method: 'GET', url: '/api/admin/repositories', cookies: await adminCookies(app) })
    expect(res.statusCode).toBe(200)
    const repos = res.json().data
    expect(repos).toHaveLength(1) // Ghost skipped — path does not exist
    expect(repos[0]).toMatchObject({ name: 'Movies', type: 'video', readOnly: true, enabled: true })
    expect(repos[0].itemCount).toBe(1) // initial scan ran automatically
  })

  it('seeds only once per data dir — a repo deleted in the UI stays deleted', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'movies'))
    const dataDir = join(tmp, 'data')
    const seedFile = join(tmp, 'repositories.yaml')
    await writeFile(seedFile, `repositories:\n  - name: Movies\n    path: ${JSON.stringify(join(tmp, 'movies'))}\n`)

    const base = {
      env: 'test' as const,
      dataDir,
      adminUsername: 'admin',
      adminPassword: 'admin-pass-123',
      loginRateMax: 1000,
      repositoriesFile: seedFile,
    }
    const first = await buildApp(base, { prober: fakeProber })
    await first.ready()
    const cookies = await adminCookies(first)
    const list = await first.inject({ method: 'GET', url: '/api/admin/repositories', cookies })
    const seeded = list.json().data
    expect(seeded).toHaveLength(1)
    const del = await first.inject({ method: 'DELETE', url: `/api/admin/repositories/${seeded[0].id}`, cookies })
    expect(del.statusCode).toBe(204)
    await first.close()

    const second = await buildApp(base, { prober: fakeProber })
    cleanups.push(() => second.close())
    await second.ready()
    const relist = await second.inject({
      method: 'GET',
      url: '/api/admin/repositories',
      cookies: await adminCookies(second),
    })
    expect(relist.json().data).toHaveLength(0) // not re-seeded
  })

  it('tolerates a missing or malformed seed file', async () => {
    const tmp = await makeTmp()
    const badFile = join(tmp, 'repositories.yaml')
    await writeFile(badFile, 'repositories: {not: [valid') // malformed YAML

    for (const repositoriesFile of [join(tmp, 'does-not-exist.yaml'), badFile]) {
      const app = await buildApp(
        {
          env: 'test',
          dataDir: ':memory:',
          adminUsername: 'admin',
          adminPassword: 'admin-pass-123',
          loginRateMax: 1000,
          repositoriesFile,
        },
        { prober: fakeProber },
      )
      await app.ready()
      const res = await app.inject({ method: 'GET', url: '/api/admin/repositories', cookies: await adminCookies(app) })
      expect(res.json().data).toHaveLength(0)
      await app.close()
    }
  })
})
