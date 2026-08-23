import { describe, it, expect, afterEach } from 'vitest'
import { Server as HttpsServer } from 'node:https'
import { Server as HttpServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { loadConfig } from '../src/lib/config'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tls')
const tls = { certFile: join(fixtures, 'cert.pem'), keyFile: join(fixtures, 'key.pem') }
const base = { env: 'test' as const, dataDir: ':memory:', adminUsername: 'admin', adminPassword: 'admin-pass-123' }

describe('native TLS', () => {
  let app: FastifyInstance | null = null
  afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }
  })

  it('creates an HTTPS server when cert+key are configured', async () => {
    app = await buildApp({ ...base, tls })
    await app.ready()
    expect(app.server).toBeInstanceOf(HttpsServer)
  })

  it('creates a plain HTTP server when TLS is not configured', async () => {
    app = await buildApp(base)
    await app.ready()
    expect(app.server).toBeInstanceOf(HttpServer)
    expect(app.server).not.toBeInstanceOf(HttpsServer)
  })

  it('fails fast with a clear error when the cert file is unreadable', async () => {
    await expect(buildApp({ ...base, tls: { certFile: '/no/such/cert.pem', keyFile: tls.keyFile } })).rejects.toThrow(/Cannot read TLS files/)
  })
})

describe('TLS config validation', () => {
  it('requires BOTH cert and key, or neither', () => {
    expect(() => loadConfig({ TLS_CERT_FILE: '/x/cert.pem' } as NodeJS.ProcessEnv)).toThrow(/BOTH/)
    expect(() => loadConfig({ TLS_KEY_FILE: '/x/key.pem' } as NodeJS.ProcessEnv)).toThrow(/BOTH/)
    expect(() => loadConfig({} as NodeJS.ProcessEnv).tls).not.toThrow()
    expect(loadConfig({ TLS_CERT_FILE: '/x/cert.pem', TLS_KEY_FILE: '/x/key.pem' } as NodeJS.ProcessEnv).tls).toEqual({
      certFile: '/x/cert.pem',
      keyFile: '/x/key.pem',
    })
  })
})
