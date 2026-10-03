import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'
import type { Prober } from '../src/services/ffprobe'
import type { Thumbnailer } from '../src/services/thumbnailer'

const fakeProber: Prober = async () => ({ width: 800, height: 600, audioTracks: 0, embeddedSubs: [] })
const fakeThumbnailer: Thumbnailer = async ({ outDir }) => {
  await mkdir(outDir, { recursive: true })
  const poster = join(outDir, 'poster.jpg')
  await writeFile(poster, 'JPEGDATA')
  return { posterPath: poster }
}

function multipart(filename: string, mime: string, bytes: Buffer): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----fwtestboundary'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    body: Buffer.concat([head, bytes, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

describe('photo upload', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let root: string
  let dataDir: string
  let writableId: string
  let readonlyId: string
  let mixedId: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-upl-'))
    dataDir = await mkdtemp(join(tmpdir(), 'fw-upld-'))
    app = await buildApp(
      { env: 'test', dataDir, adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000 },
      { prober: fakeProber, thumbnailer: fakeThumbnailer },
    )
    await app.ready()
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin-pass-123' },
    })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }

    const writable = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies,
      payload: { name: 'Photos', rootPath: root, type: 'image', readOnly: false },
    })
    writableId = writable.json().id
    const ro = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies,
      payload: { name: 'Locked', rootPath: root, type: 'image' }, // defaults to read-only
    })
    readonlyId = ro.json().id
    const mixedRoot = await mkdtemp(join(tmpdir(), 'fw-uplm-'))
    const mixed = await app.inject({
      method: 'POST',
      url: '/api/admin/repositories',
      cookies,
      payload: { name: 'Both', rootPath: mixedRoot, type: 'mixed', readOnly: false },
    })
    mixedId = mixed.json().id
  })

  afterAll(async () => {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('lists the writable repo as an upload target', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/upload/targets', cookies })
    expect(res.statusCode).toBe(200)
    const ids = (res.json().data as Array<{ id: string }>).map((t) => t.id)
    expect(ids).toContain(writableId)
    expect(ids).not.toContain(readonlyId)
  })

  it('lists every enabled library by name for any signed-in user, without paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/repositories', cookies })
    expect(res.statusCode).toBe(200)
    const libs = res.json().data as Array<Record<string, unknown>>
    expect(libs.map((l) => l.id)).toEqual(expect.arrayContaining([writableId, readonlyId]))
    expect(Object.keys(libs[0]!).sort()).toEqual(['id', 'name', 'type'])
    expect((await app.inject({ method: 'GET', url: '/api/repositories' })).statusCode).toBe(401)
  })

  it('accepts a photo, writes it under Uploads/, and indexes it', async () => {
    const { body, headers } = multipart('my cat.jpg', 'image/jpeg', Buffer.from('fakejpegbytes'))
    const res = await app.inject({
      method: 'POST',
      url: `/api/repositories/${writableId}/upload`,
      cookies,
      headers,
      payload: body,
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().uploaded).toBe(1)

    // File landed on disk under the Uploads subfolder.
    const files = await readdir(join(root, 'Uploads'))
    expect(files).toEqual(['my cat.jpg'])

    // The enqueued scan indexes it; it then appears in the library under the Uploads category.
    await app.worker.onIdle()
    const list = await app.inject({ method: 'GET', url: '/api/media', cookies })
    const card = (list.json().data as Array<{ title: string; categoryPath: string | null; type: string }>).find(
      (c) => c.title === 'my cat',
    )
    expect(card).toBeTruthy()
    expect(card!.type).toBe('image')
    expect(card!.categoryPath).toBe('Uploads')
  })

  it('rejects upload to a read-only repository', async () => {
    const { body, headers } = multipart('x.png', 'image/png', Buffer.from('x'))
    const res = await app.inject({
      method: 'POST',
      url: `/api/repositories/${readonlyId}/upload`,
      cookies,
      headers,
      payload: body,
    })
    expect(res.statusCode).toBe(403)
  })

  it('skips unsupported file types', async () => {
    const { body, headers } = multipart('notes.txt', 'text/plain', Buffer.from('hello'))
    const res = await app.inject({
      method: 'POST',
      url: `/api/repositories/${writableId}/upload`,
      cookies,
      headers,
      payload: body,
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().uploaded).toBe(0)
    expect(res.json().skipped[0].reason).toBe('unsupported file type')
  })

  it('accepts a video upload into a mixed repository and indexes it as video', async () => {
    const { body, headers } = multipart('home movie.mp4', 'video/mp4', Buffer.from('fakemp4bytes'))
    const res = await app.inject({ method: 'POST', url: `/api/repositories/${mixedId}/upload`, cookies, headers, payload: body })
    expect(res.statusCode).toBe(202)
    expect(res.json().uploaded).toBe(1)
    await app.worker.onIdle()
    const list = await app.inject({ method: 'GET', url: '/api/media', cookies })
    const card = (list.json().data as Array<{ title: string; type: string }>).find((c) => c.title === 'home movie')
    expect(card?.type).toBe('video')
  })

  it('skips a video sent to an image-only repository', async () => {
    const { body, headers } = multipart('clip.mp4', 'video/mp4', Buffer.from('x'))
    const res = await app.inject({ method: 'POST', url: `/api/repositories/${writableId}/upload`, cookies, headers, payload: body })
    expect(res.statusCode).toBe(422)
    expect(res.json().skipped[0].reason).toBe('this library only accepts images')
  })

  it('includes mixed/video repos as upload targets', async () => {
    const ids = ((await app.inject({ method: 'GET', url: '/api/upload/targets', cookies })).json().data as Array<{ id: string }>).map((t) => t.id)
    expect(ids).toContain(mixedId)
  })
})
