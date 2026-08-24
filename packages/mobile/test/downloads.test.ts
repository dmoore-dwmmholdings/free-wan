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
    await downloads.startDownload(VIDEO)
    // Not still downloading: a stuck progress row would never clear.
    expect(downloads.getDownloadState(VIDEO.id).status).not.toBe('downloading')
  })

  // Regression: `loaded` is only set at the end of the load, so concurrent callers each ran
  // the whole body and reassigned the index. A record written between two in-flight loads was
  // wiped by the slower one — a finished download vanishing during startup.
  it('shares one hydration between concurrent callers', async () => {
    const { downloads, storage } = await fresh()
    await Promise.all([downloads.loadDownloads(), downloads.loadDownloads(), downloads.loadDownloads()])
    expect(storage.default.__reads()).toBe(1)
  })

  it('keeps a download that finishes while the index is still loading', async () => {
    const { downloads, storage } = await fresh()
    const slowLoad = downloads.loadDownloads()
    const saved = downloads.startDownload(VIDEO)
    await Promise.all([slowLoad, saved])
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('done')
    const persisted = JSON.parse((await storage.default.getItem('fw_downloads_v1')) ?? '{}')
    expect(Object.keys(persisted)).toContain(VIDEO.id)
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

  it('records a failure instead of throwing, so it can be shown and retried', async () => {
    const { fs, downloads } = await fresh()
    fs.__fs.failNext()

    // Callers fire this from an onPress; throwing would only surface as an unhandled
    // rejection and the progress row would vanish with no explanation.
    await expect(downloads.startDownload(VIDEO)).resolves.toBeUndefined()

    const state = downloads.getDownloadState(VIDEO.id)
    expect(state.status).toBe('failed')
    if (state.status === 'failed') expect(state.message).toMatch(/simulated network failure/)
  })

  it('does not leave a half-finished record behind after a failure', async () => {
    const { fs, downloads } = await fresh()
    fs.__fs.failNext()
    await downloads.startDownload(VIDEO)
    // A failed download must not look downloaded, or the player opens a file that is not there.
    expect(downloads.getDownloadState(VIDEO.id).status).not.toBe('done')
  })

  it('clears the failure when the download is retried', async () => {
    const { fs, downloads } = await fresh()
    fs.__fs.failNext()
    await downloads.startDownload(VIDEO)
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('failed')

    await downloads.startDownload(VIDEO)
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('done')
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

describe('cancelling a transfer', () => {
  it('stops the download and leaves no record, rather than reporting a failure', async () => {
    const { fs, downloads } = await fresh()
    const release = fs.__fs.holdNextDownload()

    const inFlight = downloads.startDownload(VIDEO)
    // startDownload hydrates the index and resolves auth headers first; give it real time.
    await new Promise((r) => setTimeout(r, 20))
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('downloading')

    await downloads.cancelDownload(VIDEO.id)
    release()
    await inFlight

    // A cancel is deliberate. Reporting it as "Download failed — tap to try again" would be
    // telling the user something went wrong when they are the one who stopped it.
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('none')
  })

  it('discards the partially written file even when the cancel itself fails', async () => {
    const { fs, downloads } = await fresh()
    const release = fs.__fs.holdNextDownload()
    // expo deletes the partial file as part of a clean cancel, so a passing test proves
    // nothing unless the cancel is the kind that does not get that far.
    fs.__fs.failNextCancel()

    const inFlight = downloads.startDownload(VIDEO)
    // startDownload hydrates the index and resolves auth headers first; give it real time.
    await new Promise((r) => setTimeout(r, 20))
    // The stub writes as it goes, so there is a partial file to clean up.
    expect(fs.__fs.size()).toBeGreaterThan(0)

    await downloads.cancelDownload(VIDEO.id)
    release()
    await inFlight

    // Left behind, this counts against the storage total the Settings tab reports and is
    // never reachable again — nothing records that it exists.
    expect(fs.__fs.paths()).toEqual([])
  })

  it('lets the same item be downloaded again afterwards', async () => {
    const { fs, downloads } = await fresh()
    const release = fs.__fs.holdNextDownload()
    const inFlight = downloads.startDownload(VIDEO)
    // startDownload hydrates the index and resolves auth headers first; give it real time.
    await new Promise((r) => setTimeout(r, 20))
    await downloads.cancelDownload(VIDEO.id)
    release()
    await inFlight

    await downloads.startDownload(VIDEO)

    const state = downloads.getDownloadState(VIDEO.id)
    expect(state.status).toBe('done')
    if (state.status === 'done') expect(state.record.title).toBe(VIDEO.title)
  })

  it('is a no-op for an item that is not downloading', async () => {
    const { downloads } = await fresh()
    await downloads.startDownload(VIDEO)
    await expect(downloads.cancelDownload(VIDEO.id)).resolves.toBeUndefined()
    // The finished download is untouched: cancel must not double as a delete.
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('done')
  })
})

describe('the state the Downloads tab reads', () => {
  it('never has an item in flight and finished at the same time', async () => {
    const { fs, storage, downloads } = await fresh()
    // Hydrate first: it ends with a write of its own, which would otherwise swallow the hold
    // below and leave this testing nothing.
    await downloads.loadDownloads()

    // Pause the index write. The record is published before it and, before this was fixed,
    // the in-flight entry was only retired afterwards — so any other transfer's progress tick
    // during the write would have rendered two rows with the same key.
    const releaseWrite = storage.default.__holdNextWrite()

    const pending = downloads.startDownload(VIDEO)
    await new Promise((r) => setTimeout(r, 20))

    const { activeIds, doneIds } = downloads.__test.snapshot()
    const both = activeIds.filter((id) => doneIds.includes(id))
    expect(both).toEqual([])

    releaseWrite()
    await pending
    expect(fs.__fs.has(`file:///doc/downloads/${VIDEO.id}`)).toBe(true)
  })
})

describe('a cancel that lands on an all-but-finished transfer', () => {
  it('does not publish a record for a file it has just deleted', async () => {
    const { fs, downloads } = await fresh()
    // The Stop control is on screen until the in-flight entry is retired, and that does not
    // happen until the poster has been fetched — which is a separate request, over the same
    // connection that may be the reason the user is reaching for Stop.
    const releasePoster = fs.__fs.holdNextPoster()
    const started = downloads.startDownload(VIDEO)
    await new Promise((r) => setTimeout(r, 0))

    await downloads.cancelDownload(VIDEO.id)
    releasePoster()
    await started

    const state = downloads.getDownloadState(VIDEO.id)
    expect(state.status).not.toBe('done')
    expect(fs.__fs.paths()).toEqual([])
  })

  it('leaves nothing behind for the Downloads tab to list', async () => {
    const { fs, downloads } = await fresh()
    const releasePoster = fs.__fs.holdNextPoster()
    const started = downloads.startDownload(VIDEO)
    await new Promise((r) => setTimeout(r, 0))
    await downloads.cancelDownload(VIDEO.id)
    releasePoster()
    await started

    // Not a failure either: the user asked for this.
    expect(downloads.__test.snapshot()).toEqual({ activeIds: [], doneIds: [], failedIds: [] })
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('none')
  })
})

describe('a cancel that lands during the write that records a finished transfer', () => {
  it('leaves the completed download alone rather than deleting its file', async () => {
    const { fs, storage, downloads } = await fresh()
    // Armed after hydration, whose own write would otherwise absorb the hold.
    await downloads.loadDownloads()
    const releaseWrite = storage.default.__holdNextWrite()
    const started = downloads.startDownload(VIDEO)
    await new Promise((r) => setTimeout(r, 0))

    // Nothing left to stop: every byte is on disk and the record is being written. The file
    // has to survive, or the Downloads tab lists something that will not play.
    await downloads.cancelDownload(VIDEO.id)
    releaseWrite()
    await started

    const state = downloads.getDownloadState(VIDEO.id)
    expect(state.status).toBe('done')
    if (state.status === 'done') expect(fs.__fs.has(state.record.localUri)).toBe(true)
  })
})

describe('what a transfer the app never came back from leaves behind', () => {
  it('deletes a partial file that no record points at', async () => {
    const { fs, storage, downloads } = await fresh()
    await downloads.startDownload(VIDEO)
    const persisted = await storage.default.getItem('fw_downloads_v1')

    // A second, larger download that was still running when the app went away: bytes on disk,
    // and no record, because a record is only written once a transfer finishes.
    vi.resetModules()
    const fs2 = await import('./stubs/expo-file-system')
    const storage2 = await import('./stubs/async-storage')
    storage2.default.__reset()
    storage2.default.__seed('fw_downloads_v1', persisted!)
    const session2 = await import('@/lib/session')
    await session2.saveSession('https://media.example.com', 'token-abc')
    const rec = Object.values(JSON.parse(persisted!) as Record<string, { localUri: string }>)[0]!
    await fs2.downloadAsync('recreate', rec.localUri)
    await fs2.downloadAsync('half a film', 'file:///doc/downloads/media-2')

    const downloads2 = await import('@/lib/downloads')
    await downloads2.loadDownloads()

    expect(fs2.__fs.has('file:///doc/downloads/media-2')).toBe(false)
    // And the one that did finish is untouched.
    expect(fs2.__fs.has(rec.localUri)).toBe(true)
    expect(downloads2.getDownloadState(VIDEO.id).status).toBe('done')
    void fs
  })

  it('leaves a finished download and its poster alone', async () => {
    // The sweep runs against every file in the directory, so the thing it must never do is
    // mistake a poster for an orphan — its name is the id with a suffix, not the id.
    const { fs, storage, downloads } = await fresh()
    await downloads.startDownload(VIDEO)
    const before = fs.__fs.paths().slice().sort()
    expect(before).toHaveLength(2)
    const persisted = await storage.default.getItem('fw_downloads_v1')

    vi.resetModules()
    const fs2 = await import('./stubs/expo-file-system')
    const storage2 = await import('./stubs/async-storage')
    storage2.default.__reset()
    storage2.default.__seed('fw_downloads_v1', persisted!)
    const session2 = await import('@/lib/session')
    await session2.saveSession('https://media.example.com', 'token-abc')
    for (const path of before) await fs2.downloadAsync('recreate', path)

    const downloads2 = await import('@/lib/downloads')
    await downloads2.loadDownloads()

    expect(fs2.__fs.paths().slice().sort()).toEqual(before)
  })
})

describe('when the phone has no room left to write the index', () => {
  it('does not report a finished download as a failure as well', async () => {
    // This app exists to fill a phone with video, so a storage write that fails is an ordinary
    // condition here rather than an exotic one. The file has landed and the record is in
    // memory; only the write-back for the next launch failed.
    const { storage, downloads } = await fresh()
    await downloads.loadDownloads()
    storage.default.__failNextWrite()

    await downloads.startDownload(VIDEO)

    // The Downloads tab renders failures, then transfers, then finished items, keyed by id.
    // An item in two of those lists puts the same key on screen twice and reads as both.
    expect(downloads.__test.snapshot()).toEqual({
      activeIds: [],
      doneIds: [VIDEO.id],
      failedIds: [],
    })
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('done')
  })
})

/**
 * Every screen holding download state re-reads it on the same notification, and the progress
 * callback fires that notification once per chunk written — many times a second for a video
 * over a fast link. What each reader does with an answer that has not changed is therefore the
 * difference between a browsable app and a stuttering one while anything is downloading.
 */
describe('what a progress notification means to a reader that is not watching that transfer', () => {
  it('counts finished downloads only, so a transfer in flight does not move the number', async () => {
    const { fs, downloads } = await fresh()
    const release = fs.__fs.holdNextDownload()
    const pending = downloads.startDownload(VIDEO)
    // startDownload hydrates and resolves auth headers before transferring; give it real time.
    await new Promise((r) => setTimeout(r, 20))

    // Mid-flight, and the count the Browse screen reads has not moved. It says how much is
    // playable without the server, and a file that is half written is not.
    expect(downloads.getDownloadState(VIDEO.id).status).toBe('downloading')
    expect(downloads.countDownloads()).toBe(0)

    release()
    await pending
    expect(downloads.countDownloads()).toBe(1)
  })

  it('reads an unrelated item as unchanged, and the transferring one as changed', async () => {
    const { fs, downloads } = await fresh()
    const { sameDownloadState } = downloads.__test
    const release = fs.__fs.holdNextDownload()
    const pending = downloads.startDownload(VIDEO)
    await new Promise((r) => setTimeout(r, 20))

    const first = downloads.getDownloadState('media-2')
    const second = downloads.getDownloadState('media-2')
    // Two different objects, because every call builds one — which is why storing the answer
    // unconditionally re-renders whatever holds it.
    expect(second).not.toBe(first)
    expect(sameDownloadState(first, second)).toBe(true)

    // The transfer itself must still get through. Progress moving, and finishing, are both
    // changes; a comparison that swallowed either would freeze the progress bar instead.
    expect(sameDownloadState({ status: 'downloading', progress: 0.5 }, { status: 'downloading', progress: 0.6 })).toBe(false)
    expect(sameDownloadState({ status: 'downloading', progress: 1 }, downloads.getDownloadState(VIDEO.id))).toBe(false)

    release()
    await pending

    const done = downloads.getDownloadState(VIDEO.id)
    expect(sameDownloadState({ status: 'downloading', progress: 1 }, done)).toBe(false)
    expect(sameDownloadState(done, downloads.getDownloadState(VIDEO.id))).toBe(true)
    expect(sameDownloadState({ status: 'failed', message: 'a' }, { status: 'failed', message: 'b' })).toBe(false)
  })
})
