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

export type DownloadState =
  | { status: 'none' }
  | { status: 'downloading'; progress: number }
  | { status: 'done'; record: DownloadRecord }

// ---- in-memory store, persisted to AsyncStorage -----------------------------

let index: Record<string, DownloadRecord> = {}
let active: Record<string, number> = {}
let loaded = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

async function persist() {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

async function load() {
  if (loaded) return
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
  await load()
  if (index[item.id] || item.id in active) return

  active[item.id] = 0
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
        active[item.id] =
          p.totalBytesExpectedToWrite > 0
            ? p.totalBytesWritten / p.totalBytesExpectedToWrite
            : 0
        emit()
      },
    )
    const result = await task.downloadAsync()
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

    const info = await FileSystem.getInfoAsync(result.uri)
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
    await persist()
  } finally {
    delete active[item.id]
    emit()
  }
}

/** Remove a downloaded item and its files. */
export async function removeDownload(id: string): Promise<void> {
  await load()
  const record = index[id]
  if (!record) return
  await FileSystem.deleteAsync(record.localUri, { idempotent: true }).catch(() => {})
  if (record.posterUri) {
    await FileSystem.deleteAsync(record.posterUri, { idempotent: true }).catch(() => {})
  }
  delete index[id]
  await persist()
  emit()
}

function snapshot(id: string): DownloadState {
  if (index[id]) return { status: 'done', record: index[id] }
  if (id in active) return { status: 'downloading', progress: active[id] }
  return { status: 'none' }
}

/** Subscribe to one item's download state. */
export function useDownloadState(id: string): DownloadState {
  const [state, setState] = useState<DownloadState>(() => snapshot(id))
  useEffect(() => {
    const sync = () => setState(snapshot(id))
    listeners.add(sync)
    void load().then(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [id])
  return state
}

/** Subscribe to the full offline library, newest first. */
export function useDownloads(): { items: DownloadRecord[]; ready: boolean } {
  const [items, setItems] = useState<DownloadRecord[]>([])
  const [ready, setReady] = useState(loaded)
  const sync = useCallback(() => {
    setItems(Object.values(index).sort((a, b) => b.completedAt - a.completedAt))
    setReady(true)
  }, [])
  useEffect(() => {
    listeners.add(sync)
    void load().then(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [sync])
  return { items, ready }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}
