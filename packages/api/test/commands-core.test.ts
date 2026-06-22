import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandParamInput } from '@free-wan/shared'
import { buildArgv } from '../src/lib/argv-builder'
import { validateCommandArgs, type RepoPathResolver } from '../src/lib/validate-command-args'
import { resolveWithinRoot } from '../src/lib/path-safety'

describe('buildArgv — no-shell argument assembly', () => {
  it('emits literals, params, prefix/suffix, booleans, and omits missing optionals', () => {
    const tmpl = [
      '-f',
      { param: 'format' },
      '-o',
      { param: 'dest', suffix: '/%(title)s.%(ext)s' },
      { param: 'verbose', whenTrue: ['--verbose', '-v'] },
      { param: 'quiet', whenTrue: ['--quiet'] },
      { param: 'missing' },
      { param: 'url' },
    ]
    const argv = buildArgv(tmpl, {
      format: 'best',
      dest: '/media/Movies',
      verbose: true,
      quiet: false,
      url: 'https://example.com/v',
    })
    expect(argv).toEqual([
      '-f',
      'best',
      '-o',
      '/media/Movies/%(title)s.%(ext)s',
      '--verbose',
      '-v',
      'https://example.com/v',
    ])
  })

  it('keeps shell metacharacters inert (one argv entry, never split)', () => {
    const malicious = '; rm -rf / | cat $(whoami) && echo `id` > /tmp/x'
    const argv = buildArgv(['-o', { param: 'url' }], { url: malicious })
    expect(argv).toEqual(['-o', malicious]) // exactly one entry, verbatim
    expect(argv).toHaveLength(2)
  })
})

describe('validateCommandArgs', () => {
  const passthru: RepoPathResolver = (_repo, v) => `/safe/${v}`

  const params: CommandParamInput[] = [
    { name: 'url', label: 'URL', type: 'string', required: true, constraints: { pattern: '^https?://' } },
    { name: 'count', label: 'Count', type: 'number', constraints: { min: 1, max: 10 } },
    { name: 'mode', label: 'Mode', type: 'enum', constraints: { options: ['a', 'b'] } },
    { name: 'flag', label: 'Flag', type: 'boolean' },
  ]

  it('coerces and enforces constraints', () => {
    const r = validateCommandArgs(params, { url: 'https://x', count: '5', mode: 'b', flag: 'true' }, passthru)
    expect(r.ok).toBe(true)
    expect(r.values).toMatchObject({ url: 'https://x', count: 5, mode: 'b', flag: true })
  })

  it('rejects required-missing, bad pattern, out-of-range, and bad enum', () => {
    expect(validateCommandArgs(params, {}, passthru).errors.url).toBe('required')
    expect(validateCommandArgs(params, { url: 'ftp://x' }, passthru).errors.url).toBe('pattern')
    expect(validateCommandArgs(params, { url: 'https://x', count: '99' }, passthru).errors.count).toBe('max')
    expect(validateCommandArgs(params, { url: 'https://x', mode: 'z' }, passthru).errors.mode).toBe('enum')
  })
})

describe('repo_path resolution rejects traversal (real resolver)', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fw-cmdpath-'))
    await mkdir(join(root, 'Downloads'), { recursive: true })
    await writeFile(join(root, 'ok.txt'), 'x')
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('accepts an in-repo path and rejects escapes', () => {
    const resolver: RepoPathResolver = (_repo, value) => resolveWithinRoot(root, value)
    const params: CommandParamInput[] = [
      { name: 'dest', label: 'Dest', type: 'repo_path', required: true, constraints: { repoId: 'r1' } },
    ]
    const good = validateCommandArgs(params, { dest: 'Downloads' }, resolver)
    expect(good.ok).toBe(true)
    expect(String(good.values.dest)).toContain('Downloads')

    expect(validateCommandArgs(params, { dest: '../../etc/passwd' }, resolver).errors.dest).toBe('path')
    expect(validateCommandArgs(params, { dest: '/etc/passwd' }, resolver).errors.dest).toBe('path')
  })
})
