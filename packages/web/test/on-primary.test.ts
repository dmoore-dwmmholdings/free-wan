import { describe, it, expect } from 'vitest'
import { BRANDING_PRESETS } from '@free-wan/shared'
import { applyBrandingVars } from '../src/lib/theme'

describe('the web app and the mobile app pick the same on-primary', () => {
  it('agrees on all seven presets', () => {
    const chosen: Record<string, string> = {}
    for (const [id, p] of Object.entries(BRANDING_PRESETS)) {
      const el = document.createElement('div')
      applyBrandingVars(el, { colors: p.colors, radius: p.radius, fonts: { heading: 'Sora', body: 'Figtree' } })
      chosen[id] = el.style.getPropertyValue('--fw-on-primary')
    }
    // The same table asserted in packages/mobile/test/palette.test.ts.
    expect(chosen).toEqual({
      midnight: '#ffffff',
      slate: '#15120c',
      forest: '#15120c',
      ember: '#15120c',
      neon: '#15120c',
      paper: '#ffffff',
      linen: '#ffffff',
    })
  })
})
