import { describe, it, expect } from 'vitest'
import { normalizeServerUrl } from '@/lib/session'

describe('normalizeServerUrl', () => {
  it('assumes https for a bare hostname (the tailnet case)', () => {
    expect(normalizeServerUrl('media.tailnet.ts.net')).toBe('https://media.tailnet.ts.net')
  })

  it('keeps an explicit scheme, including plain http for a LAN server', () => {
    expect(normalizeServerUrl('http://192.168.1.5:8080')).toBe('http://192.168.1.5:8080')
    expect(normalizeServerUrl('https://media.example.com')).toBe('https://media.example.com')
  })

  it('preserves a non-default port', () => {
    expect(normalizeServerUrl('media.example.com:8443')).toBe('https://media.example.com:8443')
  })

  it('trims surrounding whitespace from a pasted address', () => {
    expect(normalizeServerUrl('  media.example.com  ')).toBe('https://media.example.com')
  })

  it('reduces a pasted deep link to its origin', () => {
    // Users paste whatever is in the browser bar; every API path is built from the origin.
    expect(normalizeServerUrl('https://media.example.com/watch/abc?t=12')).toBe(
      'https://media.example.com',
    )
    expect(normalizeServerUrl('https://media.example.com/')).toBe('https://media.example.com')
  })

  it('rejects empty or whitespace-only input', () => {
    expect(normalizeServerUrl('')).toBeNull()
    expect(normalizeServerUrl('   ')).toBeNull()
  })

  it('rejects input that is not a usable address', () => {
    expect(normalizeServerUrl('http://')).toBeNull()
    expect(normalizeServerUrl('://nope')).toBeNull()
  })
})
