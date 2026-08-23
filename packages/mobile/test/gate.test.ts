import { describe, expect, it } from 'vitest'
import { gateRedirect, type GateState } from '@/lib/gate'

const base: GateState = {
  ready: true,
  signedIn: false,
  mustChangePassword: false,
  segment: undefined,
}
const at = (s: Partial<GateState>) => gateRedirect({ ...base, ...s })

describe('deciding where the gate sends someone', () => {
  it('decides nothing before stored session state has been read', () => {
    // Navigating here would bounce anyone with a valid session out to the login screen for
    // the moment it takes to read the keychain.
    expect(at({ ready: false })).toBeNull()
    expect(at({ ready: false, signedIn: true })).toBeNull()
    expect(at({ ready: false, signedIn: true, mustChangePassword: true })).toBeNull()
  })

  it('sends a signed-out visitor to the login screen', () => {
    expect(at({ segment: undefined })).toBe('/login')
    expect(at({ segment: 'media' })).toBe('/login')
    expect(at({ segment: 'downloads' })).toBe('/login')
  })

  it('leaves a signed-out visitor alone once they are on it', () => {
    // Returning '/login' here would replace the route on every render and the screen would
    // never settle.
    expect(at({ segment: 'login' })).toBeNull()
  })

  it('blocks every route until the starting password is replaced', () => {
    const forced = { signedIn: true, mustChangePassword: true }
    expect(at({ ...forced, segment: undefined })).toBe('/change-password')
    expect(at({ ...forced, segment: 'media' })).toBe('/change-password')
    expect(at({ ...forced, segment: 'settings' })).toBe('/change-password')
    // Including the login screen: signed in is signed in.
    expect(at({ ...forced, segment: 'login' })).toBe('/change-password')
  })

  it('leaves them alone once they are on the change-password screen', () => {
    expect(at({ signedIn: true, mustChangePassword: true, segment: 'change-password' })).toBeNull()
  })

  it('releases both gate screens once signed in and unblocked', () => {
    expect(at({ signedIn: true, segment: 'login' })).toBe('/')
    expect(at({ signedIn: true, segment: 'change-password' })).toBe('/')
  })

  it('leaves an ordinary route alone when signed in and unblocked', () => {
    expect(at({ signedIn: true, segment: undefined })).toBeNull()
    expect(at({ signedIn: true, segment: 'media' })).toBeNull()
    expect(at({ signedIn: true, segment: 'collection' })).toBeNull()
  })

  it('puts signing out ahead of the password rule', () => {
    // A cleared session while the stale `me` still says the password must change: the answer
    // is the login screen, not a change-password screen with no session to change it with.
    expect(at({ signedIn: false, mustChangePassword: true, segment: 'media' })).toBe('/login')
    expect(at({ signedIn: false, mustChangePassword: true, segment: 'login' })).toBeNull()
  })

  it('never sends anywhere that would immediately send somewhere else', () => {
    // Any destination has to be a fixed point, or the two redirects fight each other forever.
    const states: GateState[] = []
    for (const ready of [true, false]) {
      for (const signedIn of [true, false]) {
        for (const mustChangePassword of [true, false]) {
          for (const segment of [undefined, 'login', 'change-password', 'media']) {
            states.push({ ready, signedIn, mustChangePassword, segment })
          }
        }
      }
    }
    for (const state of states) {
      const to = gateRedirect(state)
      if (!to) continue
      const landedOn = to === '/' ? undefined : to.slice(1)
      expect(gateRedirect({ ...state, segment: landedOn }), `${JSON.stringify(state)} → ${to}`).toBeNull()
    }
  })
})
