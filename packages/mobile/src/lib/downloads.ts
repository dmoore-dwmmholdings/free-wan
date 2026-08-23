import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
// SDK 54 replaced this module's API with File/Directory, but the new download call takes no
// progress callback — and a multi-gigabyte video needs a progress bar. `expo-file-system/legacy`
// is the supported entry point for exactly this case; revisit when the new API reports progress.
import * as FileSystem from 'expo-file-system/legacy'
import type { MediaCard } from '@free-wan/shared'
import { apiUrl, authHeaders } from './api'

const INDEX_KEY = 'fw_downloads_v1'
const DIR = `${FileSystem.documentDirectory}downloads/`

export interface DownloadRecord {
  id: string
  title: string
  type: MediaCard['type']
  durationSec: number | null
  /** file:// URI of the downloaded media, playable with no server connection. */
  localUri: string
  /** file:// URI of the cached poster, so the offline list still renders thumbnails. */
  posterUri: string | null
  bytes: number
  completedAt: number
}

/** A transfer in flight. Carries enough to render a row before the file exists. */
export interface ActiveDownload {
  id: string
  title: string
  type: MediaCard['type']
  durationSec: number | null
  /** 0..1, or 0 while the server has not reported a total size yet. */
  progress: number
}

/** A transfer that did not finish. Kept so the failure is visible and retryable. */
export interface FailedDownload extends ActiveDownload {
  error: string
}

export type DownloadState =
  | { status: 'none' }
  | { status: 'downloading'; progress: number }
  | { status: 'failed'; message: string }
  | { status: 'done'; record: DownloadRecord }

// ---- in-memory store, persisted to AsyncStorage -----------------------------

let index: Record<string, DownloadRecord> = {}
let active: Record<string, ActiveDownload> = {}
let failures: Record<string, FailedDownload> = {}
// Live transfers, so one can be stopped. A phone on a metered connection needs a way out of a
// multi-gigabyte download it started by mistake.
let tasks: Record<string, { cancelAsync: () => Promise<void> }> = {}
// Ids the user cancelled. A cancel surfaces as the same rejected download as a dropped
// connection, and without this the Downloads tab would report "failed" for something the user
// asked to stop, and offer to retry it.
let cancelled = new Set<string>()
let loaded = false
let hydrating: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

async function persist() {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

/** Hydrate the index from storage, dropping records whose files no longer exist. */
export async function loadDownloads(): Promise<void> {
  if (loaded) return
  // Concurrent callers must share one load. Both hooks and startDownload call this on mount,
  // and `loaded` is only set at the end — so without this each call would run the whole body
  // and reassign `index`, letting a slower one overwrite a record the faster one had already
  // written. A download finishing during startup would simply vanish.
  hydrating ??= hydrate()
  try {
    await hydrating
  } finally {
    hydrating = null
  }
}

async function hydrate(): Promise<void> {
  const raw = await AsyncStorage.getItem(INDEX_KEY)
  index = raw ? (JSON.parse(raw) as Record<string, DownloadRecord>) : {}
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})

  // A record whose file vanished (OS reclaimed storage, user cleared data) must not linger,
  // or the player opens a dead file:// URI and fails with no explanation.
  const missing = await Promise.all(
    Object.values(index).map(async (r) => {
      const info = await FileSystem.getInfoAsync(r.localUri)
      return info.exists ? null : r.id
    }),
  )
  for (const id of missing) if (id) delete index[id]

  // The other half of the same problem: a file with no record. A record is only written once a
  // transfer finishes, so a download interrupted by the app going away — force-quit, a reboot,
  // the system reclaiming memory partway through a multi-gigabyte video — leaves everything it
  // had written behind with nothing pointing at it. Nothing else ever looks at those files: the
  // Downloads tab and the storage figure in Settings are both built from the index, so the
  // space is not merely wasted, it is invisible. Sweeping here is safe because hydration
  // happens once and every transfer waits on it, so nothing in flight can be caught by it.
  //
  // Matched on name rather than on URI. The names are ours, built from ids; a `localUri` has
  // been out to the platform and back, and deleting someone's downloads over a difference in
  // encoding is not a risk worth taking.
  const keep = new Set<string>()
  for (const r of Object.values(index)) {
    keep.add(r.id)
    keep.add(`${r.id}.poster.jpg`)
  }
  const found = await FileSystem.readDirectoryAsync(DIR).catch(() => [] as string[])
  for (const name of found) {
    if (keep.has(name)) continue
    await FileSystem.deleteAsync(`${DIR}${name}`, { idempotent: true }).catch(() => {})
  }

  loaded = true
  await persist()
  emit()
}

// ---- public API -------------------------------------------------------------

/** Download a media item for offline playback. Resolves when the file is on disk. */
export async function startDownload(item: {
  id: string
  title: string
  type: MediaCard['type']
  durationSec?: number | null
}): Promise<void> {
  await loadDownloads()
  if (index[item.id] || item.id in active) return

  // Starting again is how a failure is retried, so clear the last one.
  delete failures[item.id]

  active[item.id] = {
    id: item.id,
    title: item.title,
    type: item.type,
    durationSec: item.durationSec ?? null,
    progress: 0,
  }
  emit()

  const headers = await authHeaders()
  const target = `${DIR}${item.id}`
  const posterTarget = `${DIR}${item.id}.poster.jpg`

  try {
    const task = FileSystem.createDownloadResumable(
      await apiUrl(`/api/media/${item.id}/raw`),
      target,
      { headers },
      (p) => {
        const entry = active[item.id]
        if (entry) {
          entry.progress =
            p.totalBytesExpectedToWrite > 0
              ? p.totalBytesWritten / p.totalBytesExpectedToWrite
              : 0
          emit()
        }
      },
    )
    tasks[item.id] = task
    const result = await task.downloadAsync()
    // expo resolves to undefined rather than rejecting when a transfer is cancelled.
    if (!result) throw new Error('Download was cancelled')

    // Poster is best-effort: a missing thumbnail should not fail the download.
    let posterUri: string | null = null
    try {
      const poster = await FileSystem.downloadAsync(
        await apiUrl(`/api/media/${item.id}/poster`),
        posterTarget,
        { headers },
      )
      posterUri = poster.status === 200 ? poster.uri : null
    } catch {
      posterUri = null
    }

    // Stop is still on screen at this point. The in-flight entry is not retired until the
    // line below, and fetching the poster is a second request over the same connection that
    // may well be the reason the user is reaching for Stop. A cancel landing in that gap has
    // already deleted both files, so publishing a record now would leave the Downloads tab
    // offering an item whose file is gone — it plays nowhere, and nothing notices until the
    // next cold start prunes it.
    const info = await FileSystem.getInfoAsync(result.uri)
    if (cancelled.has(item.id)) {
      if (posterUri) await FileSystem.deleteAsync(posterUri, { idempotent: true }).catch(() => {})
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {})
      return
    }

    index[item.id] = {
      id: item.id,
      title: item.title,
      type: item.type,
      durationSec: item.durationSec ?? null,
      localUri: result.uri,
      posterUri,
      bytes: info.exists && 'size' in info ? info.size : 0,
      completedAt: Date.now(),
    }
    // Retire the in-flight entry in the same breath as publishing the finished one. Writing
    // the index and only clearing `active` in the `finally` leaves the item in both for the
    // length of a storage write, and any other transfer's progress tick emits during that
    // window — the Downloads tab lists failed, then active, then done, keyed by id, so it
    // would render the same id twice. The `finally` still clears it for the failure paths.
    delete active[item.id]
    await persist()
  } catch (err) {
    // A download failing is ordinary — a phone leaves the tailnet mid-transfer. Record it so
    // the Downloads tab can say so and offer a retry; throwing here would only surface as an
    // unhandled rejection, and the progress row would vanish with no explanation.
    if (!cancelled.has(item.id)) {
      const entry = active[item.id]
      failures[item.id] = {
        id: item.id,
        title: item.title,
        type: item.type,
        durationSec: item.durationSec ?? null,
        progress: entry?.progress ?? 0,
        error: err instanceof Error ? err.message : 'Download failed',
      }
    }
  } finally {
    delete active[item.id]
    delete tasks[item.id]
    cancelled.delete(item.id)
    emit()
  }
}

/**
 * Stop a transfer in progress and discard what was written. Does nothing for an item that is
 * not currently downloading, so a double tap is harmless.
 */
export async function cancelDownload(id: string): Promise<void> {
  const task = tasks[id]
  // `active` is cleared a moment before the finished record is written, while the task itself
  // lives until the storage write lands. A cancel arriving in that gap is aimed at a transfer
  // that no longer exists: the file is complete and about to be listed, and deleting it would
  // publish a record pointing at nothing. The transfer is over, so there is nothing to stop —
  // the item can be removed from the Downloads tab like any other.
  if (!task || !active[id]) return

  // Marked before the await: cancelling makes the download reject, and the catch above runs
  // as soon as it does. Setting this afterwards would race, and the item would be reported
  // as a failure roughly half the time.
  cancelled.add(id)
  await task.cancelAsync().catch(() => {})

  // expo deletes the partial file itself, but only for a cancel it completed cleanly; a
  // half-written file left behind would count against the storage the Settings tab reports.
  await FileSystem.deleteAsync(`${DIR}${id}`, { idempotent: true }).catch(() => {})
  await FileSystem.deleteAsync(`${DIR}${id}.poster.jpg`, { idempotent: true }).catch(() => {})

  delete active[id]
  delete tasks[id]
  emit()
}

/** Remove a downloaded item and its files. */
export async function removeDownload(id: string): Promise<void> {
  await loadDownloads()
  const record = index[id]
  if (!record) return
  await FileSystem.deleteAsync(record.localUri, { idempotent: true }).catch(() => {})
  if (record.posterUri) {
    await FileSystem.deleteAsync(record.posterUri, { idempotent: true }).catch(() => {})
  }
  delete index[id]
  delete failures[id]
  await persist()
  emit()
}

/** Current state for one item, without subscribing. */
export function getDownloadState(id: string): DownloadState {
  if (index[id]) return { status: 'done', record: index[id] }
  const running = active[id]
  if (running) return { status: 'downloading', progress: running.progress }
  const failure = failures[id]
  if (failure) return { status: 'failed', message: failure.error }
  return { status: 'none' }
}

/** Subscribe to one item's download state. */
export function useDownloadState(id: string): DownloadState {
  const [state, setState] = useState<DownloadState>(() => getDownloadState(id))
  useEffect(() => {
    const sync = () => setState(getDownloadState(id))
    listeners.add(sync)
    void loadDownloads().then(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [id])
  return state
}

/**
 * The offline library: completed downloads newest first, plus anything still transferring.
 * In-flight items belong here — starting a large download and switching to this tab must not
 * look like nothing happened.
 */
export function useDownloads(): {
  items: DownloadRecord[]
  active: ActiveDownload[]
  failed: FailedDownload[]
  ready: boolean
} {
  const [items, setItems] = useState<DownloadRecord[]>([])
  const [active_, setActive] = useState<ActiveDownload[]>([])
  const [failed, setFailed] = useState<FailedDownload[]>([])
  const [ready, setReady] = useState(loaded)
  const sync = useCallback(() => {
    setItems(Object.values(index).sort((a, b) => b.completedAt - a.completedAt))
    setActive(Object.values(active).map((a) => ({ ...a })))
    setFailed(Object.values(failures).map((f) => ({ ...f })))
    setReady(true)
  }, [])
  useEffect(() => {
    listeners.add(sync)
    void loadDownloads().then(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [sync])
  return { items, active: active_, failed, ready }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  // An empty library uses nothing; the 1 KB floor below is for real files that would
  // otherwise round down to "0 KB", and must not make an empty total claim storage.
  if (bytes <= 0) return '0 KB'
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

/**
 * Test-only view of the two collections the Downloads tab concatenates. Exposed because the
 * invariant that matters — an item is never both in flight and finished — is only observable
 * between them, and the screen keys its rows by id.
 */
export const __test = {
  snapshot: () => ({ activeIds: Object.keys(active), doneIds: Object.keys(index) }),
}
