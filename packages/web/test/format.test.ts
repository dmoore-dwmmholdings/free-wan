import { describe, it, expect } from 'vitest'
import { formatDuration, resolutionLabel, rawUrl } from '../src/lib/media'

describe('format helpers', () => {
  it('formats durations as m:ss (null for none)', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(3661)).toBe('61:01')
  })

  it('labels resolution by height', () => {
    expect(resolutionLabel(null)).toBeNull()
    expect(resolutionLabel(2160)).toBe('4K')
    expect(resolutionLabel(1080)).toBe('1080p')
    expect(resolutionLabel(720)).toBe('720p')
    expect(resolutionLabel(480)).toBe('SD')
  })

  it('builds raw image URLs with optional width', () => {
    expect(rawUrl('abc')).toBe('/api/media/abc/raw')
    expect(rawUrl('abc', 320)).toBe('/api/media/abc/raw?w=320')
  })
})
