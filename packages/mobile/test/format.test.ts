import { describe, it, expect } from 'vitest'
import { formatDuration } from '@/lib/media'
import { formatBytes } from '@/lib/downloads'

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(599)).toBe('9:59')
  })

  it('formats an hour or more as h:mm:ss with a padded minute', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('rounds fractional seconds rather than truncating', () => {
    expect(formatDuration(59.6)).toBe('1:00')
  })

  it('returns null when there is nothing worth showing', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(-5)).toBeNull()
  })
})

describe('formatBytes', () => {
  it('scales to GB and MB', () => {
    expect(formatBytes(2_400_000_000)).toBe('2.4 GB')
    expect(formatBytes(350_000_000)).toBe('350 MB')
  })

  it('falls back to KB and never reports a downloaded file as 0', () => {
    expect(formatBytes(12_000)).toBe('12 KB')
    expect(formatBytes(1)).toBe('1 KB')
  })
})
