import { describe, expect, it } from 'vitest'
import { BRANDING_PRESETS, DEFAULT_BRANDING } from '@free-wan/shared'
import { derivePalette, isLight, mix, parseColor, parseRadius, withAlpha } from '@/lib/palette'

describe('parsing colours', () => {
  it('reads long and short hex', () => {
    expect(parseColor('#6e4cff')).toEqual({ r: 110, g: 76, b: 255 })
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('reads rgb() and rgba()', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 })
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3 })
  })

  it('rejects anything it cannot read', () => {
    expect(parseColor('rebeccapurple')).toBeNull()
    expect(parseColor('#12345')).toBeNull()
    expect(parseColor('')).toBeNull()
  })
})

describe('mixing colours the way color-mix does', () => {
  it('weights the first colour by the given fraction', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 1)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('keeps the token usable when a colour cannot be parsed', () => {
    // A bad value from the branding API should cost that one token, not the app's chrome.
    expect(mix('#123456', 'not-a-colour', 0.5)).toBe('#123456')
  })

  it('turns a colour into a translucent one', () => {
    expect(withAlpha('#e9e9ee', 0.11)).toBe('rgba(233,233,238,0.11)')
  })
})

describe('judging whether a colour is light', () => {
  it('separates the dark presets from the light ones', () => {
    expect(isLight('#0b0b10')).toBe(false)
    expect(isLight('#ffffff')).toBe(true)
  })

  it('uses luminance rather than an average of the channels', () => {
    // Both average to the same value. Yellow is plainly light and blue plainly dark, which a
    // plain average would get wrong — and this decides the status bar's icon colour.
    expect(isLight('#ffff00')).toBe(true)
    expect(isLight('#0000ff')).toBe(false)
  })
})

describe('deriving the palette', () => {
  it('reproduces the built-in dark palette', () => {
    // These were the literals the theme carried before branding was followed, so matching
    // them proves the arithmetic here agrees with the web app's color-mix values.
    const p = derivePalette(DEFAULT_BRANDING.colors)
    expect(p.bg).toBe('#0b0b10')
    expect(p.surface).toBe('#16161d')
    expect(p.primary).toBe('#6e4cff')
    expect(p.border).toBe('rgba(233,233,238,0.11)')
    expect(p.primaryTint).toBe('rgba(110,76,255,0.15)')
    expect(p.onPrimary).toBe('#ffffff')
  })

  it('derives the tones the web app computes, not the literals this file used to carry', () => {
    // The theme previously hardcoded #1f1f27 and #9a9aa6. Neither is what the web's
    // color-mix actually produces from the same bases — they were eyeballed, and had drifted.
    // Following the formula moves both slightly, which is the point: the two apps now agree.
    const p = derivePalette(DEFAULT_BRANDING.colors)
    expect(p.surface2).toBe(mix(DEFAULT_BRANDING.colors.text, DEFAULT_BRANDING.colors.surface, 0.06))
    expect(p.surface2).toBe('#23232a')
    expect(p.muted).toBe(mix(DEFAULT_BRANDING.colors.text, DEFAULT_BRANDING.colors.background, 0.65))
    // Worked out away from this code, the way the browser would: 233 x 0.65 + 11 x 0.35 is
    // 155.30, and 238 x 0.65 + 16 x 0.35 is 160.30.
    expect(p.muted).toBe('#9b9ba0')
  })

  it('produces a readable palette for every preset, light ones included', () => {
    // The reason branding was not followed before was that half-applying it looks broken.
    // Every preset has to come out with text that reads against its own background.
    for (const [name, preset] of Object.entries(BRANDING_PRESETS)) {
      const p = derivePalette(preset.colors)
      expect(parseColor(p.surface2), `${name} surface2`).not.toBeNull()
      expect(parseColor(p.muted), `${name} muted`).not.toBeNull()
      // Muted text is mixed toward the background, so it must not land on the background.
      expect(p.muted, `${name} muted`).not.toBe(p.bg)
      // A light preset must not end up asking for light status-bar icons.
      expect(isLight(p.bg), `${name} bg`).toBe(preset.mode === 'light')
    }
  })
})

/** WCAG relative-luminance contrast ratio, so the presets can be checked for readability. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const { r, g, b: bl } = parseColor(c)!
    const ch = (v: number) => {
      const x = v / 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('readability of every preset', () => {
  // No preset is exempt. `linen` used to be: muted against its background came out at 4.41:1,
  // and the shortfall was recorded here with a test that asserted it, on the grounds that the
  // mix was shared with the web app and bending it in this file alone would only make the two
  // disagree. That was the right call at the time and the wrong place to stop — the share was
  // raised from 62% to 65% in both apps, which is what the 62% had been chosen to do in the
  // first place, and every preset now clears with room to spare.
  it.each(Object.keys(BRANDING_PRESETS))('keeps muted text readable on %s', (name) => {
    const p = derivePalette(BRANDING_PRESETS[name]!.colors)
    expect(contrast(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.muted, p.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.keys(BRANDING_PRESETS))('keeps body text readable on %s', (name) => {
    const p = derivePalette(BRANDING_PRESETS[name]!.colors)
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('reading the radius', () => {
  it('takes the number out of a CSS length and derives the small one', () => {
    // The web sets --fw-radius-sm to radius * 0.58; 16px gives the 9 the theme used.
    expect(parseRadius('16px')).toEqual({ sm: 9, md: 16 })
    expect(parseRadius('24px')).toEqual({ sm: 14, md: 24 })
  })

  it('falls back to the default rather than producing NaN', () => {
    // A NaN radius silently renders square corners everywhere.
    expect(parseRadius('')).toEqual({ sm: 9, md: 16 })
    expect(parseRadius('none')).toEqual({ sm: 9, md: 16 })
  })
})

describe('deciding whether a background is light', () => {
  it('weighs the channels the way the eye does', () => {
    // Green and blue are the same number in a plain average of the channels, and nothing like
    // each other to look at. Asserting both directions at once is what pins the weighting:
    // no unweighted formula can call one of these light and the other dark.
    expect(isLight('#00ff00')).toBe(true)
    expect(isLight('#0000ff')).toBe(false)
  })

  it('turns over where black text stops being the more readable of the two', () => {
    // A mid-grey. Black on it reaches 5.3:1, white 3.9:1, so it wants dark chrome — which the
    // old midpoint-of-the-scale threshold of 0.5 got backwards.
    expect(isLight('#808080')).toBe(true)
    // And well below the crossover it does not.
    expect(isLight('#3a3a3a')).toBe(false)
  })

  it('is unambiguous for every background that ships', () => {
    for (const preset of Object.values(BRANDING_PRESETS)) {
      expect(isLight(preset.colors.background)).toBe(preset.mode === 'light')
    }
  })
})
