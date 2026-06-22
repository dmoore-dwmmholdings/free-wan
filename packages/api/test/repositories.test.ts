import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'

const fakeProber: Prober = async (abs) =>
  abs.endsWith('.mp4')
    ? {
        durationS: 60,
        width: 1280,
        height: 720,
        container: 'mov,mp4,m4a',
        videoCodec: 'h264',
        audioCodec: 'aac',
        audioTracks: 1,
        embeddedSubs: [],
      }
    : { width: 640, height: 480, audioTracks: 0, embeddedSubs: [] }

describe('Phase 2 — repository routes & scanning', () => {
  let app: FastifyInstance
  let adminCookies: Record<string, string>
  let root: string

  beforeAll(async () => {
    app = await buildApp(
      { env: 'test', dataDir: ':memory:', adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber },
    )
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin-pass-123' },
    })
    const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!
    adminCookies = { [SESSION_COOKIE]: c.value }

    root = await mkdtemp(join(tmpdir(), 'fw-repo-'))
    await mkdir(join(root, 'Clips'), { recursive: true })
    await writeFile(join(root, 'Clips', 'a.mp4'), 'x')
    await writeFile(join(root, 'photo.jpg'), 'x')
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
  })

  it('rejects a repository whose rootPath does not exist (422)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies: adminCookies,
      payload: { name: 'Bad', rootPath: join(root, 'nope'), type: 'mixed' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('creates, lists, patches a repository and runs a scan to completion', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies: adminCookies,
      payload: { name: 'Library', rootPath: root, type: 'mixed' },
    })
    expect(create.statusCode).toBe(201)
    const repo = create.json()
    expect(repo).toMatchObject({ name: 'Library', type: 'mixed', itemCount: 0 })

    const list = await app.inject({ method: 'GET', url: '/api/admin/repositories', cookies: adminCookies })
    expect(list.json().data).toHaveLength(1)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/repositories/${repo.id}`,
      cookies: adminCookies,
      payload: { name: 'Renamed' },
    })
    expect(patch.json().name).toBe('Renamed')

    // enqueue scan → worker drains → status reports counts
    const scan = await app.inject({
      method: 'POST',
      url: `/api/admin/repositories/${repo.id}/scan`,
      cookies: adminCookies,
      payload: {},
    })
    expect(scan.statusCode).toBe(202)
    expect(scan.json().jobId).toBeTruthy()

    await app.worker.onIdle()

    const status = await app.inject({
      method: 'GET',
      url: `/api/admin/repositories/${repo.id}/scan`,
      cookies: adminCookies,
    })
    expect(status.json()).toMatchObject({ status: 'succeeded', found: 2, indexed: 2 })

    const after = await app.inject({ method: 'GET', url: '/api/admin/repositories', cookies: adminCookies })
    expect(after.json().data[0].itemCount).toBe(2)
  })

  it('requires admin (anon gets 401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/repositories' })
    expect(res.statusCode).toBe(401)
  })

  it('deletes a repository (204) and clears the index', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/admin/repositories', cookies: adminCookies })
    const id = list.json().data[0].id
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/repositories/${id}`, cookies: adminCookies })
    expect(del.statusCode).toBe(204)
    const after = await app.inject({ method: 'GET', url: '/api/admin/repositories', cookies: adminCookies })
    expect(after.json().data).toHaveLength(0)
  })
})
