import { describe, expect, it } from 'vitest'
import { clipCommandFor } from '@/lib/clips'

const looping = { startS: 10, endS: 20, loop: true }
const once = { startS: 10, endS: 20, loop: false }

describe('holding a clip inside its window', () => {
  it('leaves the player alone while inside the clip', () => {
    expect(clipCommandFor(10, once)).toBeNull()
    expect(clipCommandFor(15, once)).toBeNull()
    expect(clipCommandFor(19.9, once)).toBeNull()
  })

  it('rewinds and keeps playing when the clip loops', () => {
    expect(clipCommandFor(20, looping)).toEqual({ seekTo: 10, pause: false })
    expect(clipCommandFor(20.25, looping)).toEqual({ seekTo: 10, pause: false })
  })

  it('rewinds as well as pausing when the clip does not loop', () => {
    // The bug this pins: pausing alone left the playhead past the out-point, so the next
    // press of play was met with another stop within a quarter of a second. The clip could
    // be watched once and then never again without hunting for the in-point on a scrubber
    // that spans the whole source video.
    expect(clipCommandFor(20, once)).toEqual({ seekTo: 10, pause: true })
  })

  it('acts at the out-point itself, not only past it', () => {
    // Position is only sampled every 0.25s, so waiting for strictly-greater would overshoot
    // by a frame or more on every pass.
    expect(clipCommandFor(20, once)).not.toBeNull()
  })

  it('settles rather than firing again at the position it rewinds to', () => {
    // Whatever it does has to be a fixed point, or the handler fights itself four times a
    // second for as long as the screen is open.
    for (const clip of [looping, once]) {
      const command = clipCommandFor(clip.endS, clip)!
      expect(clipCommandFor(command.seekTo, clip)).toBeNull()
    }
  })

  it('does not drag a viewer forward who scrubbed before the in-point', () => {
    // Scrubbing is the viewer's business; only the out-point is enforced.
    expect(clipCommandFor(0, once)).toBeNull()
    expect(clipCommandFor(9, looping)).toBeNull()
  })
})
