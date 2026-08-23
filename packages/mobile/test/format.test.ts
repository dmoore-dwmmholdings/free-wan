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

  // Regression: the Settings screen showed "Storage used  1 KB" with no downloads,
  // because the floor above was applied to an empty total as well.
  it('reports nothing used when there are no downloads', () => {
    expect(formatBytes(0)).toBe('0 KB')
  })
})

describe('durations too short to be worth saying', () => {
  it('says nothing for a photo', () => {
    // Every image in a library has one: ffprobe reports a single frame as 0.04 seconds, and
    // rounding that gave a badge reading 0:00 on every photo tile in the grid.
    expect(formatDuration(0.04)).toBeNull()
  })

  it('says nothing for anything under a second', () => {
    expect(formatDuration(0.9)).toBeNull()
  })

  it('starts saying something at a second', () => {
    expect(formatDuration(1)).toBe('0:01')
  })
})
