/**
 * Node stub for expo-file-system/legacy, backed by a virtual filesystem so the download
 * manager's real behaviour (progress, sizing, pruning, deletion) can be exercised.
 */
export const documentDirectory = 'file:///doc/'

const files = new Map<string, number>()
let failNextDownload = false
let downloadedBytes = 123_456
let hold: Promise<void> | null = null
let pendingRelease: (() => void) | null = null
let failNextCancel = false
let posterHold: Promise<void> | null = null

export const __fs = {
  reset() {
    files.clear()
    failNextDownload = false
    downloadedBytes = 123_456
    hold = null
    pendingRelease = null
    failNextCancel = false
    posterHold = null
  },
  /** Simulate the OS reclaiming a file behind the app's back. */
  evict(uri: string) {
    files.delete(uri)
  },
  has: (uri: string) => files.has(uri),
  size: () => files.size,
  paths: () => [...files.keys()],
  failNext() {
    failNextDownload = true
  },
  /** Simulate a cancel that does not complete, so it cleans nothing up of its own accord. */
  failNextCancel() {
    failNextCancel = true
  },
  setDownloadSize(bytes: number) {
    downloadedBytes = bytes
  },
  /**
   * Pause the poster fetch, which happens after the media file is already written. That gap
   * is the only place a cancel can land on a transfer that has in every other sense finished.
   * Returns a release fn.
   */
  holdNextPoster() {
    let release!: () => void
    posterHold = new Promise<void>((resolve) => {
      release = resolve
    })
    return release
  },
  /** Pause the next transfer midway so in-flight state can be inspected. Returns a release fn. */
  holdNextDownload() {
    let release!: () => void
    hold = new Promise<void>((resolve) => {
      release = resolve
    })
    pendingRelease = release
    return release
  },
}

export async function makeDirectoryAsync(): Promise<void> {}

export async function readDirectoryAsync(dirUri: string): Promise<string[]> {
  const prefix = dirUri.endsWith('/') ? dirUri : `${dirUri}/`
  return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
}

export async function getInfoAsync(uri: string) {
  const size = files.get(uri)
  return size === undefined ? { exists: false as const } : { exists: true as const, size }
}

export async function downloadAsync(_url: string, target: string) {
  if (posterHold) {
    const pending = posterHold
    posterHold = null
    await pending
  }
  files.set(target, 2_048)
  return { uri: target, status: 200 }
}

type ProgressCb = (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void

export function createDownloadResumable(
  _url: string,
  target: string,
  _opts: unknown,
  onProgress?: ProgressCb,
) {
  let isCancelled = false
  const releaseHold = () => pendingRelease?.()

  return {
    async downloadAsync() {
      if (failNextDownload) {
        failNextDownload = false
        throw new Error('simulated network failure')
      }
      onProgress?.({ totalBytesWritten: 512, totalBytesExpectedToWrite: 1024 })
      // A real transfer writes as it goes, so a cancel has something to clean up.
      files.set(target, 512)
      if (hold) {
        const pending = hold
        hold = null
        await pending
      }
      // expo resolves to undefined for a cancelled transfer rather than rejecting.
      if (isCancelled) return undefined
      onProgress?.({ totalBytesWritten: 1024, totalBytesExpectedToWrite: 1024 })
      files.set(target, downloadedBytes)
      return { uri: target }
    },
    async cancelAsync() {
      isCancelled = true
      if (failNextCancel) {
        failNextCancel = false
        // Cancelled, but the partial file is left behind for the caller to deal with.
        hold = null
        releaseHold()
        throw new Error('cancel failed')
      }
      files.delete(target)
      // Let the held transfer finish unblocking, as a real cancel would.
      hold = null
      releaseHold()
    },
  }
}

export async function deleteAsync(uri: string): Promise<void> {
  files.delete(uri)
}

// ---- uploads -----------------------------------------------------------------
//
// Absent until now, along with `FileSystemUploadType`. Both reach `uploads.ts` through a
// namespace import, so a missing one is `undefined` at the call site rather than an error at
// load — and since no test had ever driven `uploadFile`, nothing noticed. `stubs.test.ts` now
// checks namespace members too, which is what turned this up.

export const FileSystemUploadType = { MULTIPART: 'multipart', BINARY_CONTENT: 'binary' } as const

interface UploadOptions {
  httpMethod?: string
  uploadType?: string
  fieldName?: string
  mimeType?: string
  headers?: Record<string, string>
}

let uploadReply: { status: number; body: string } = {
  status: 202,
  body: JSON.stringify({ files: ['photo.jpg'], skipped: [] }),
}
let uploadHold: Promise<void> | null = null
let releaseUpload: (() => void) | null = null

export const __uploads = {
  /** What the next `uploadAsync` answers with. The route replies 202 or 422 and nothing else. */
  reply(status: number, body: unknown) {
    uploadReply = { status, body: typeof body === 'string' ? body : JSON.stringify(body) }
  },
  /** Hold the next transfer open so a cancel can arrive mid-flight. Returns a release. */
  hold() {
    let release!: () => void
    uploadHold = new Promise<void>((resolve) => {
      release = resolve
    })
    releaseUpload = release
    return release
  },
  reset() {
    uploadReply = { status: 202, body: JSON.stringify({ files: ['photo.jpg'], skipped: [] }) }
    uploadHold = null
    releaseUpload = null
    this.calls = []
  },
  /** Every upload attempted, so a test can check what was sent and in what order. */
  calls: [] as { url: string; fileUri: string; options: UploadOptions }[],
}

export function createUploadTask(
  url: string,
  fileUri: string,
  options: UploadOptions,
  onProgress?: (p: { totalBytesSent: number; totalBytesExpectedToSend: number }) => void,
) {
  let isCancelled = false
  return {
    async uploadAsync() {
      __uploads.calls.push({ url, fileUri, options })
      onProgress?.({ totalBytesSent: 512, totalBytesExpectedToSend: 1024 })
      if (uploadHold) {
        const pending = uploadHold
        uploadHold = null
        await pending
      }
      // expo resolves to undefined for a cancelled transfer rather than rejecting, the same as
      // it does for a download.
      if (isCancelled) return undefined
      onProgress?.({ totalBytesSent: 1024, totalBytesExpectedToSend: 1024 })
      return uploadReply
    },
    async cancelAsync() {
      isCancelled = true
      uploadHold = null
      releaseUpload?.()
    },
  }
}
