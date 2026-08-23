import { describe, expect, it } from 'vitest'
import { displayWidthFor } from '@/lib/media'

const at = (screenWidth: number, pixelRatio: number, sourceWidth: number | null) =>
  displayWidthFor({ screenWidth, pixelRatio, sourceWidth })

describe('displayWidthFor', () => {
  it('asks for enough pixels to fill the screen it will be drawn on', () => {
    // A 430pt phone at 3x is 1290 real pixels across, so anything below that is a visible
    // softening; a 390pt phone at 2x needs 780.
    expect(at(430, 3, 4032)).toBe(1600)
    expect(at(390, 2, 4032)).toBe(960)
  })

  it('rounds up to a step, so the server caches a few sizes rather than one per handset', () => {
    // Every distinct width is a JPEG the server renders and keeps. Phone widths vary by a few
    // points between models, and none of those differences are worth a separate file.
    expect(at(393, 3, 4032)).toBe(at(412, 3, 4032))
    expect(at(430, 3, 4032)! % 320).toBe(0)
  })

  it('stops at a ceiling, because a phone cannot show the difference', () => {
    expect(at(1440, 2, 6000)).toBe(2560)
  })

  it('takes the original when the photo is no bigger than the request', () => {
    // The server resizes with `scale=w:-2`, which enlarges as readily as it shrinks — asking
    // for more than the source has returns a larger, softer file than the original.
    expect(at(430, 3, 1200)).toBeNull()
    expect(at(430, 3, 1600)).toBeNull()
    expect(at(430, 3, 1601)).toBe(1600)
  })

  it('takes the original when the size of the photo is not known', () => {
    expect(at(430, 3, null)).toBeNull()
    expect(at(430, 3, 0)).toBeNull()
  })
})
