import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { SESSION_COOKIE } from '../src/lib/auth'

const NODE = process.execPath

// node -e <script> <msg> <code> : echoes msg, leaks env presence, exits with code.
const PROBE = 'const a=process.argv.slice(1);process.stdout.write("MSG["+a[0]+"] SECRET["+(process.env.FW_TEST_SECRET||"NONE")+"]");process.exit(Number(a[1]||0))'
const FLOOD = 'process.stdout.write("x".repeat(5000));process.exit(0)'
const SLEEP = 'setTimeout(()=>process.exit(0), 10000)'

describe('Phase 9 — custom commands (sandboxed runner)', () => {
  let app: FastifyInstance
  let admin: Record<string, string>
  let viewer: Record<string, string>
  let probeId: string

  async function login(u: string, p: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  }
  async function createCmd(body: Record<string, unknown>) {
    const res = await app.inject({ method: 'POST', url: '/api/admin/commands', cookies: admin, payload: body })
    return res
  }
  /**
   * Wait until a run reports the status being waited for, rather than for a fixed stretch of
   * time. A constant here is a guess about how fast the machine is: too small and the test is
   * flaky under load, too large and it is slow for everyone. This suite runs alongside three
   * others under `pnpm -r`, so the machine is not idle.
   */
  async function waitForStatus(runId: string, want: string, timeoutMs = 5000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let status = ''
    while (Date.now() < deadline) {
      const res = await app.inject({ method: 'GET', url: `/api/command-runs/${runId}`, cookies: admin })
      status = res.json().status as string
      if (status === want) return status
      await new Promise((r) => setTimeout(r, 10))
    }
    return status
  }

  async function runAndWait(id: string, args: Record<string, unknown>, cookies = admin) {
    const res = await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies, payload: { args } })
    if (res.statusCode !== 202) return { res, run: null }
    await app.worker.onIdle()
    const run = await app.inject({ method: 'GET', url: `/api/command-runs/${res.json().runId}`, cookies })
    return { res, run: run.json() as { status: string; exitCode: number | null; output: string; resolvedArgv: string[]; truncated: boolean } }
  }

  beforeAll(async () => {
    process.env.FW_TEST_SECRET = 'topsecret'
    app = await buildApp(
      { env: 'test', dataDir: ':memory:', adminUsername: 'admin', adminPassword: 'admin-pass-123', loginRateMax: 1000, commandAllowedExecutables: [NODE] },
      {},
    )
    await app.ready()
    admin = await login('admin', 'admin-pass-123')
    await app.inject({ method: 'POST', url: '/api/admin/users', cookies: admin, payload: { username: 'viewer', password: 'viewer-pass-1', role: 'user' } })
    viewer = await login('viewer', 'viewer-pass-1')

    const create = await createCmd({
      name: 'probe',
      executable: NODE,
      argTemplate: ['-e', PROBE, { param: 'msg' }, { param: 'code' }],
      timeoutS: 30,
      envAllowlist: [],
      params: [
        { name: 'msg', label: 'Message', type: 'string', required: true },
        { name: 'code', label: 'Exit code', type: 'number', default: '0' },
      ],
    })
    expect(create.statusCode).toBe(201)
    probeId = create.json().id
  })

  afterAll(async () => {
    await app.close()
    delete process.env.FW_TEST_SECRET
  })

  it('rejects a non-allowlisted executable', async () => {
    const res = await createCmd({ name: 'evil', executable: '/bin/sh', argTemplate: [], params: [] })
    expect(res.statusCode).toBe(422)
  })

  it('runs with no shell — metacharacters are inert, secrets not inherited', async () => {
    const malicious = '; rm -rf / | cat $(whoami)'
    const { res, run } = await runAndWait(probeId, { msg: malicious, code: 0 })
    expect(res.statusCode).toBe(202)
    expect(run!.status).toBe('succeeded')
    expect(run!.exitCode).toBe(0)
    expect(run!.output).toContain(`MSG[${malicious}]`) // verbatim, never executed
    expect(run!.output).toContain('SECRET[NONE]') // FW_TEST_SECRET not in allowlist
    expect(run!.resolvedArgv).toContain(malicious) // one argv entry
  })

  it('records a non-zero exit as failed', async () => {
    const { run } = await runAndWait(probeId, { msg: 'x', code: 3 })
    expect(run!.status).toBe('failed')
    expect(run!.exitCode).toBe(3)
  })

  it('re-validates arguments server-side (422, no execution)', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/commands/${probeId}/run`, cookies: admin, payload: { args: {} } })
    expect(res.statusCode).toBe(422) // msg is required
  })

  it('caps output and flags truncated', async () => {
    const c = await createCmd({ name: 'flood', executable: NODE, argTemplate: ['-e', FLOOD], maxOutputKb: 1, params: [] })
    const { run } = await runAndWait(c.json().id, {})
    expect(run!.truncated).toBe(true)
    expect(run!.output.length).toBeLessThanOrEqual(1024)
  })

  it('enforces a timeout', async () => {
    const c = await createCmd({ name: 'sleeper', executable: NODE, argTemplate: ['-e', SLEEP], timeoutS: 1, params: [] })
    const { run } = await runAndWait(c.json().id, {})
    expect(run!.status).toBe('timeout')
  })

  it('cancels a running command', async () => {
    const c = await createCmd({ name: 'sleeper2', executable: NODE, argTemplate: ['-e', SLEEP], timeoutS: 30, params: [] })
    const start = await app.inject({ method: 'POST', url: `/api/commands/${c.json().id}/run`, cookies: admin, payload: { args: {} } })
    const runId = start.json().runId
    // Cancel it once it is actually running, which is what this test is named for. The wait
    // used to be a flat 150ms; measuring showed the run reports `running` within a millisecond
    // here, so the number was telling nobody anything and would have been the wrong number on a
    // slower machine.
    expect(await waitForStatus(runId, 'running')).toBe('running')
    const cancel = await app.inject({ method: 'POST', url: `/api/command-runs/${runId}/cancel`, cookies: admin })
    expect(cancel.statusCode).toBe(202)
    await app.worker.onIdle()
    const run = await app.inject({ method: 'GET', url: `/api/command-runs/${runId}`, cookies: admin })
    expect(run.json().status).toBe('canceled')
  })

  it('enforces run permissions', async () => {
    // viewer is not allowed (allowNonAdmin false / canRunCommands false)
    expect((await app.inject({ method: 'GET', url: '/api/commands', cookies: viewer })).json().data).toHaveLength(0)
    expect((await app.inject({ method: 'POST', url: `/api/commands/${probeId}/run`, cookies: viewer, payload: { args: { msg: 'x' } } })).statusCode).toBe(403)
    // and admin endpoints are admin-only
    expect((await app.inject({ method: 'GET', url: '/api/admin/commands', cookies: viewer })).statusCode).toBe(403)
  })

  it('admin listing exposes the executable allowlist and the full definition (for the editor)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/commands', cookies: admin })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: Array<{ id: string; executable: string; argTemplate: unknown[] }>; executables: string[] }
    expect(body.executables).toContain(NODE)
    const probe = body.data.find((c) => c.id === probeId)!
    expect(probe.executable).toBe(NODE)
    expect(Array.isArray(probe.argTemplate)).toBe(true)
  })

  it('edits a command via PATCH', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/admin/commands/${probeId}`, cookies: admin, payload: { description: 'updated desc' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().description).toBe('updated desc')
    const list = await app.inject({ method: 'GET', url: '/api/admin/commands', cookies: admin })
    const probe = (list.json().data as Array<{ id: string; description: string }>).find((c) => c.id === probeId)!
    expect(probe.description).toBe('updated desc')
  })

  it('enforces the per-command concurrency cap (default 1) with 409, freeing on completion', async () => {
    const create = await createCmd({
      name: 'sleeper',
      executable: NODE,
      argTemplate: ['-e', SLEEP],
      timeoutS: 30,
      params: [],
    })
    expect(create.statusCode).toBe(201)
    expect(create.json().maxConcurrent).toBe(1)
    const id = create.json().id as string

    const first = await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies: admin, payload: { args: {} } })
    expect(first.statusCode).toBe(202)
    // Second launch while the first is queued/running is rejected.
    const second = await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies: admin, payload: { args: {} } })
    expect(second.statusCode).toBe(409)

    // Cancel the first → the slot frees and a new run is accepted.
    await app.inject({ method: 'POST', url: `/api/command-runs/${first.json().runId}/cancel`, cookies: admin })
    await app.worker.onIdle()
    const third = await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies: admin, payload: { args: {} } })
    expect(third.statusCode).toBe(202)
    await app.inject({ method: 'POST', url: `/api/command-runs/${third.json().runId}/cancel`, cookies: admin })
    await app.worker.onIdle()
  })

  it('a raised maxConcurrent admits that many parallel runs', async () => {
    const create = await createCmd({
      name: 'sleeper2',
      executable: NODE,
      argTemplate: ['-e', SLEEP],
      timeoutS: 30,
      maxConcurrent: 2,
      params: [],
    })
    const id = create.json().id as string
    const a = await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies: admin, payload: { args: {} } })
    const b = await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies: admin, payload: { args: {} } })
    const c = await app.inject({ method: 'POST', url: `/api/commands/${id}/run`, cookies: admin, payload: { args: {} } })
    expect(a.statusCode).toBe(202)
    expect(b.statusCode).toBe(202)
    expect(c.statusCode).toBe(409) // third exceeds the cap of 2
    for (const r of [a, b]) {
      await app.inject({ method: 'POST', url: `/api/command-runs/${r.json().runId}/cancel`, cookies: admin })
    }
    await app.worker.onIdle()
  })
})
