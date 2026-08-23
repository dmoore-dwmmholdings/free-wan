import { useQuery } from '@tanstack/react-query'
// Same legacy entry point the downloader uses, and for the same reason: it is the API that
// reports progress. A 2 GB video needs a progress bar.
import * as FileSystem from 'expo-file-system/legacy'
import { api, apiUrl, authHeaders } from './api'

/** A repository the signed-in user may upload into. */
export interface UploadTarget {
  id: string
  name: string
  type: 'image' | 'video' | 'mixed'
}

/** One file's outcome. The server accepts a batch partially, so this is per file. */
export interface UploadOutcome {
  name: string
  ok: boolean
  reason?: string
}

/** The server caps a batch at 50 files and 2 GB each; see packages/api/src/routes/uploads.ts. */
export const MAX_FILES_PER_BATCH = 50

export function useUploadTargets() {
  return useQuery({
    queryKey: ['upload-targets'],
    queryFn: () => api.get<{ data: UploadTarget[] }>('/api/upload/targets'),
  })
}

/**
 * One file's outcome, read from the server's own answer rather than inferred. The route
 * reports the names it saved and the ones it rejected with a reason, and a saved name can
 * differ from the one sent: uploading IMG_0001.jpg twice leaves the second as
 * "IMG_0001 (1).jpg", which is worth telling the user.
 */
function outcomeFor(
  name: string,
  body: { files?: string[]; skipped?: Array<{ name: string; reason: string }> },
): UploadOutcome {
  const saved = body.files?.[0]
  if (saved) return { name: saved, ok: true }
  const reason = (body.skipped ?? []).find((sk) => sk.name === name)?.reason
  return { name, ok: false, reason: reason ?? 'the server rejected it without saying why' }
}

/**
 * Upload one file to a repository. Sequential by design: these are photos and videos off a
 * phone camera, and several 2 GB transfers at once would compete for the same uplink and make
 * every one of them slower, with a progress bar that no longer means anything.
 */
export async function uploadFile(
  repositoryId: string,
  file: { uri: string; name: string; mimeType?: string | null },
  onProgress?: (fraction: number) => void,
): Promise<UploadOutcome> {
  const url = await apiUrl(`/api/repositories/${repositoryId}/upload`)
  const headers = await authHeaders()

  const task = FileSystem.createUploadTask(
    url,
    file.uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      // The route reads whatever multipart parts arrive; the name only has to be non-empty.
      fieldName: 'file',
      // The picker does not always know the type — the route falls back to the extension, so
      // an unknown type is better left absent than guessed at.
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      headers,
    },
    (p) => {
      if (p.totalBytesExpectedToSend > 0) {
        onProgress?.(p.totalBytesSent / p.totalBytesExpectedToSend)
      }
    },
  )

  const res = await task.uploadAsync()
  if (!res) throw new Error('Upload was cancelled')

  // 202 means at least one file landed; 422 means every one was rejected. Both carry the same
  // body, and both are answers rather than errors — anything else is not.
  if (res.status !== 202 && res.status !== 422) {
    throw new Error(`Upload failed (HTTP ${res.status})`)
  }

  let body: { files?: string[]; skipped?: Array<{ name: string; reason: string }> }
  try {
    body = JSON.parse(res.body) as typeof body
  } catch {
    throw new Error('The server sent a response this app could not read')
  }

  return outcomeFor(file.name, body)
}

export const __test = { outcomeFor }
