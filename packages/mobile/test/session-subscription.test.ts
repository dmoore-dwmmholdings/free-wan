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

  it('stops notifying after unsubscribe', async () => {
    unsubscribe()
    await saveSession('https://media.example.com', 'token-xyz')
    expect(calls).toBe(0)
  })
})
