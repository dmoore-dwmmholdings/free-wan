/**
 * Node stub for expo-file-system/legacy, backed by a virtual filesystem so the download
 * manager's real behaviour (progress, sizing, pruning, deletion) can be exercised.
 */
export const documentDirectory = 'file:///doc/'

const files = new Map<string, number>()
let failNextDownload = false
let downloadedBytes = 123_456

export const __fs = {
  reset() {
    files.clear()
    failNextDownload = false
    downloadedBytes = 123_456
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
  setDownloadSize(bytes: number) {
    downloadedBytes = bytes
  },
}

export async function makeDirectoryAsync(): Promise<void> {}

export async function getInfoAsync(uri: string) {
  const size = files.get(uri)
  return size === undefined ? { exists: false as const } : { exists: true as const, size }
}

export async function downloadAsync(_url: string, target: string) {
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
  return {
    async downloadAsync() {
      if (failNextDownload) {
        failNextDownload = false
        throw new Error('simulated network failure')
      }
      onProgress?.({ totalBytesWritten: 512, totalBytesExpectedToWrite: 1024 })
      onProgress?.({ totalBytesWritten: 1024, totalBytesExpectedToWrite: 1024 })
      files.set(target, downloadedBytes)
      return { uri: target }
    },
  }
}

export async function deleteAsync(uri: string): Promise<void> {
  files.delete(uri)
}
