import { describe, it, expect, beforeEach, vi } from 'vitest'

const VIDEO = { id: 'media-1', title: 'Big Buck Bunny', type: 'video' as const, durationSec: 33 }

/**
 * The download store keeps its index in module scope, so each test needs a fresh copy of
 * both it and the stubbed filesystem it writes through.
 */
async function fresh() {
  vi.resetModules()
  const fs = await import('./stubs/expo-file-system')
  const storage = await import('./stubs/async-storage')
  fs.__fs.reset()
  storage.default.__reset()
  // Downloads build absolute URLs from the stored server address.
  const session = await import('@/lib/session')
  await session.saveSession('https://media.example.com', 'token-abc')
  const downloads = await import('@/lib/downloads')
  return { fs, storage, downloads }
}

describe('offline download manager', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('stores the media file, its poster, and a record describing both', async () => {
    const { fs, downloads } = await fresh()
    await downloads.startDownload(VIDEO)

    const state = downloads.getDownloadState(VIDEO.id)
    expect(fs.__fs.size()).toBe(2) // media + poster
    expect(state).toMatchObject({
      status: 'done',
      record: { id: 'media-1', title: 'Big Buck Bunny', type: 'video', durationSec: 33, bytes: 123_456 },
    })
  })

  it('reports progress while the transfer is still running', async () => {
    const { fs, downloads } = await fresh()
    const release = fs.__fs.holdNextDownload()

    const pending = downloads.startDownload(VIDEO)
    // startDownload first hydrates the index and resolves auth headers; give it real time.
    await new Promise((r) => setTimeout(r, 20))

    const midFlight = downloads.getDownloadState(VIDEO.id)
    expect(midFlight.status).toBe('downloading')
    if (midFlight.status === 'downloading') expect(midFlight.progress).toBeCloseTo(0.5)

    release()
    await pending
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('done')
  })

  it('clears the in-flight entry when a transfer fails', async () => {
    const { fs, downloads } = await fresh()
    fs.__fs.failNext()
    await expect(downloads.startDownload(VIDEO)).rejects.toThrow()
    // Neither downloading nor done: a stuck progress row would never clear.
    expect(downloads.getDownloadState(VIDEO.id)).toEqual({ status: 'none' })
  })

  it('is a no-op for something already downloaded', async () => {
    const { fs, downloads } = await fresh()
    await downloads.startDownload(VIDEO)
    const before = fs.__fs.paths()
    await downloads.startDownload(VIDEO)
    expect(fs.__fs.paths()).toEqual(before)
  })

  it('removes both files and the record', async () => {
    const { fs, downloads } = await fresh()
    await downloads.startDownload(VIDEO)
    await downloads.removeDownload(VIDEO.id)
    expect(fs.__fs.size()).toBe(0)
    expect(downloads.getDownloadState(VIDEO.id)).toEqual({ status: 'none' })
  })

  it('leaves no half-finished record when the transfer fails', async () => {
    const { fs, downloads } = await fresh()
    fs.__fs.failNext()
    await expect(downloads.startDownload(VIDEO)).rejects.toThrow(/simulated network failure/)
    // A failed download must not look downloaded, or the player opens a file that is not there.
    expect(downloads.getDownloadState(VIDEO.id)).toEqual({ status: 'none' })
  })

  it('keeps a downloaded item across a restart', async () => {
    const { downloads, storage } = await fresh()
    await downloads.startDownload(VIDEO)
    const persisted = await storage.default.getItem('fw_downloads_v1')

    // Same virtual filesystem, fresh module state: the record must survive.
    vi.resetModules()
    const fs2 = await import('./stubs/expo-file-system')
    const storage2 = await import('./stubs/async-storage')
    storage2.default.__reset()
    storage2.default.__seed('fw_downloads_v1', persisted!)
    const session2 = await import('@/lib/session')
    await session2.saveSession('https://media.example.com', 'token-abc')
    // Recreate the file the previous run wrote, as a real device would still have it.
    const rec = Object.values(JSON.parse(persisted!) as Record<string, { localUri: string }>)[0]!
    await fs2.downloadAsync('recreate', rec.localUri)

    const downloads2 = await import('@/lib/downloads')
    await downloads2.loadDownloads()
    expect(downloads2.getDownloadState(VIDEO.id).status).toBe('done')
  })

  it('drops records whose files the OS reclaimed', async () => {
    const { fs, downloads, storage } = await fresh()
    await downloads.startDownload(VIDEO)
    const mediaPath = fs.__fs.paths().find((p) => !p.endsWith('.poster.jpg'))!
    fs.__fs.evict(mediaPath)

    // Reload from persisted state, as a fresh app launch would.
    const persisted = await storage.default.getItem('fw_downloads_v1')
    vi.resetModules()
    const fs2 = await import('./stubs/expo-file-system')
    const storage2 = await import('./stubs/async-storage')
    fs2.__fs.reset()
    storage2.default.__reset()
    const session2 = await import('@/lib/session')
    await session2.saveSession('https://media.example.com', 'token-abc')
    storage2.default.__seed('fw_downloads_v1', persisted!)
    const downloads2 = await import('@/lib/downloads')

    await downloads2.loadDownloads()
    expect(downloads2.getDownloadState(VIDEO.id)).toEqual({ status: 'none' })
  })
})
