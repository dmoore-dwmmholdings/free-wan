import { describe, it, expect, beforeEach } from 'vitest'
import { saveSession, clearSession, getToken, subscribeSession } from '@/lib/session'

describe('session change notification', () => {
  let calls = 0
  let unsubscribe = () => {}

  beforeEach(() => {
    calls = 0
    unsubscribe()
    unsubscribe = subscribeSession(() => {
      calls += 1
    })
  })

  // Regression: the auth gate reads the session once on mount. Without a notification it kept
  // its null token after a successful login and bounced the user back to the login screen.
  it('notifies subscribers when a session is saved', async () => {
    await saveSession('https://media.example.com', 'token-abc')
    expect(calls).toBe(1)
    expect(await getToken()).toBe('token-abc')
  })

  it('notifies subscribers when the session is cleared', async () => {
    await saveSession('https://media.example.com', 'token-abc')
    calls = 0
    await clearSession()
    expect(calls).toBe(1)
    expect(await getToken()).toBeNull()
  })

  // Regression: clearSession awaited the keychain delete unguarded. When that rejected the
  // in-memory token survived and no subscriber was told, so a 401 left the auth gate holding
  // a session the server had already refused — and the user on a retry that could not work.
  it('still ends the session when the keychain refuses to delete', async () => {
    const store = await import('./stubs/expo-secure-store')
    await saveSession('https://media.example.com', 'token-abc')
    calls = 0

    store.__failDeletes(true)
    try {
      await expect(clearSession()).resolves.toBeUndefined()
      expect(await getToken()).toBeNull()
      expect(calls).toBe(1)
    } finally {
      store.__failDeletes(false)
    }
  })

  it('stops notifying after unsubscribe', async () => {
    unsubscribe()
    await saveSession('https://media.example.com', 'token-xyz')
    expect(calls).toBe(0)
  })
})
