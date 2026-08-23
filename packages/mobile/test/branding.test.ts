import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BRANDING, type Branding } from '@free-wan/shared'
import { startBranding } from '@/lib/branding'
import { theme, applyBranding } from '@/theme'
import { Appearance } from '@/../test/stubs/react-native'

vi.mock('@/lib/session', () => ({
  getServerUrl: () => mockServer(),
  subscribeSession: (listener: () => void) => {
    sessionListeners.add(listener)
    return () => sessionListeners.delete(listener)
  },
}))

vi.mock('@/lib/api', () => ({
  api: { get: () => mockFetch() },
}))

let mockServer: () => Promise<string | null>
let mockFetch: () => Promise<Branding>
let sessionListeners: Set<() => void>

/** A branding payload that is unmistakably not the built-in one. */
const LINEN: Branding = {
  ...DEFAULT_BRANDING,
  siteName: 'Dawson Media',
  theme: 'linen',
  mode: 'light',
  colors: {
    primary: '#8a5a2b',
    accent: '#b4713c',
    background: '#f3efe6',
    surface: '#fbf8f2',
    text: '#241d15',
  },
}

/** Let every pending microtask and the promise chain inside `load` run to completion. */
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

/** Pretend a sign-in happened: a server now exists, and subscribers are told. */
const signIn = async (server: string) => {
  mockServer = async () => server
  for (const listener of [...sessionListeners]) listener()
  await settle()
}

beforeEach(() => {
  sessionListeners = new Set()
  mockServer = async () => null
  mockFetch = async () => LINEN
  Appearance.schemes.length = 0
  applyBranding(DEFAULT_BRANDING)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startBranding', () => {
  it('brands a first run at sign-in, without a restart', async () => {
    // A first launch has no server stored, so there is nothing to ask at startup. Branding
    // must still arrive the moment signing in creates one — the alternative shipped an app
    // that stayed on the built-in dark palette until it was killed and reopened.
    const stop = startBranding(
      () => {},
      () => {},
    )
    await settle()
    expect(theme.color.bg).toBe(DEFAULT_BRANDING.colors.background)

    await signIn('https://media.example.net')

    expect(theme.color.bg).toBe(LINEN.colors.background)
    expect(theme.siteName).toBe('Dawson Media')
    stop()
  })

  it('follows the brand with the platform colour scheme', async () => {
    const stop = startBranding(
      () => {},
      () => {},
    )
    await settle()
    // The built-in palette is dark, and that is settled before anything is fetched so the
    // login screen does not get the phone's keyboard.
    expect(Appearance.schemes).toEqual(['dark'])

    await signIn('https://media.example.net')

    expect(Appearance.schemes).toEqual(['dark', 'light'])
    stop()
  })

  it('re-renders the caller only when the tokens actually change', async () => {
    const applied = vi.fn()
    const stop = startBranding(() => {}, applied)
    await settle()
    expect(applied).not.toHaveBeenCalled()

    await signIn('https://media.example.net')
    expect(applied).toHaveBeenCalledTimes(1)

    // Same server again — a sign-out and sign-in to the same place, say. Nothing has changed,
    // so the root must not be told to render again.
    for (const listener of [...sessionListeners]) listener()
    await settle()
    expect(applied).toHaveBeenCalledTimes(1)
    stop()
  })

  it('fetches again when the session moves to a different server', async () => {
    const stop = startBranding(
      () => {},
      () => {},
    )
    await settle()
    await signIn('https://one.example.net')
    expect(theme.color.bg).toBe(LINEN.colors.background)

    mockFetch = async () => ({ ...DEFAULT_BRANDING, siteName: 'Other' })
    await signIn('https://two.example.net')

    expect(theme.siteName).toBe('Other')
    stop()
  })

  it('retries a server whose branding could not be fetched', async () => {
    const stop = startBranding(
      () => {},
      () => {},
    )
    await settle()

    mockFetch = async () => {
      throw new Error('offline')
    }
    await signIn('https://media.example.net')
    expect(theme.color.bg).toBe(DEFAULT_BRANDING.colors.background)

    // Same server, second attempt: a failure must not mark it as done, or an app that was
    // opened out of coverage would stay unbranded for the rest of its life.
    mockFetch = async () => LINEN
    for (const listener of [...sessionListeners]) listener()
    await settle()

    expect(theme.color.bg).toBe(LINEN.colors.background)
    stop()
  })

  it('settles at startup even with no server to ask', async () => {
    const settled = vi.fn()
    const stop = startBranding(settled, () => {})
    await settle()

    // Not after the cap — immediately. The caller holds the whole app on a blank screen
    // until this fires, and a first launch has no server by definition.
    expect(settled).toHaveBeenCalledTimes(1)
    stop()
  })

  it('settles at the cap when the server accepts the connection and says nothing', async () => {
    mockServer = async () => 'https://slow.example.net'
    mockFetch = () => new Promise<Branding>(() => {})
    const settled = vi.fn()
    const stop = startBranding(settled, () => {})
    await settle()
    expect(settled).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2000)

    expect(settled).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops listening once torn down', async () => {
    const applied = vi.fn()
    const stop = startBranding(() => {}, applied)
    await settle()
    expect(sessionListeners.size).toBe(1)

    stop()

    // Checked directly, not through the effect. A teardown that left the listener in place
    // would still look right from the outside, because the cancelled flag stops the branding
    // being applied — but the listeners would pile up, one per remount, for the life of the
    // process.
    expect(sessionListeners.size).toBe(0)

    await signIn('https://media.example.net')
    expect(applied).not.toHaveBeenCalled()
    expect(theme.color.bg).toBe(DEFAULT_BRANDING.colors.background)
  })
})
