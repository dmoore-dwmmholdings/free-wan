import { describe, expect, it, afterEach } from 'vitest'
import { onlineManager } from '@tanstack/react-query'
import { createQueryClient } from '@/lib/query'

afterEach(() => onlineManager.setOnline(true))

describe('query client network mode', () => {
  // The bug this guards: with the default 'online' network mode, a query that fails while
  // onlineManager believes the device is offline has its retry *paused*. Having never
  // recorded a result it stays `pending`, so the screen shows no data, no error and no
  // spinner, and no remount or refocus ever revives it. This is not hypothetical — signing
  // in after a 401 left the browse screen with no folder chips for the rest of the session.
  it('reports a failure as an error rather than pausing when believed offline', async () => {
    onlineManager.setOnline(false)
    const client = createQueryClient()

    await client
      .fetchQuery({
        queryKey: ['boom'],
        queryFn: () => Promise.reject(new Error('401')),
        retry: false,
      })
      .catch(() => undefined)

    const state = client.getQueryCache().find({ queryKey: ['boom'] })?.state
    expect(state?.fetchStatus).not.toBe('paused')
    expect(state?.status).toBe('error')
  })

  it('does not pause mutations when believed offline', async () => {
    onlineManager.setOnline(false)
    const client = createQueryClient()

    const result = await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.resolve('sent') })
      .execute(undefined)

    expect(result).toBe('sent')
  })
})
