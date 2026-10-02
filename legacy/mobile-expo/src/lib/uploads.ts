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

/** The subset of a picker asset that naming depends on. */
export interface NameableAsset {
  uri: string
  fileName?: string | null
  type?: 'image' | 'video' | 'livePhoto' | 'pairedVideo' | null
}

/**
 * A filename for something the picker returned.
 *
 * The picker leaves `fileName` null often enough to matter, and the URI is not a reliable
 * substitute: an Android `content://` URI has no extension at all, a URI can carry a query
 * string, and a dot can appear in a directory rather than in the file. The name matters
 * because the server falls back to the extension when it cannot place the MIME type, so a
 * bad one turns an ordinary photo into "unsupported file type".
 *
 * The index keeps unnamed files distinct within one batch; without it two of them would share
 * a name and the summary would report fewer results than were sent.
 */
export function fileNameFor(asset: NameableAsset, index: number): string {
  const given = asset.fileName?.trim()
  if (given) return given
  return `upload-${index + 1}.${extensionFor(asset)}`
}

function extensionFor(asset: NameableAsset): string {
  // Query and fragment first, then the last path segment: a dot in a parent directory says
  // nothing about the file.
  const path = asset.uri.split(/[?#]/)[0] ?? ''
  const segment = path.split('/').pop() ?? ''
  const dot = segment.lastIndexOf('.')
  const candidate = dot > 0 ? segment.slice(dot + 1) : ''
  // Only accept something that looks like an extension. Anything else means the URI does not
  // carry one, whatever it happens to contain.
  if (/^[a-z0-9]{1,5}$/i.test(candidate)) return candidate.toLowerCase()
  // `pairedVideo` is the movie half of a live photo, so it is a video too.
  return asset.type === 'video' || asset.type === 'pairedVideo' ? 'mp4' : 'jpg'
}

/**
 * Why the upload button cannot open the picker, if it cannot.
 *
 * `no-targets` and `unreachable` are the two that matter, and telling them apart is the whole
 * point. A server that was never reached has said nothing about which of its libraries accept
 * uploads, and answering a tap with "no library on your server accepts uploads" states as fact
 * something that was never learned — the same lie an empty state tells when it stands in for
 * a failed request, which is why `ErrorState` exists.
 */
export type UploadBlock = 'loading' | 'unreachable' | 'no-targets' | null

export function uploadBlocker(state: {
  loading: boolean
  targets: UploadTarget[] | null
}): UploadBlock {
  if (state.loading) return 'loading'
  if (state.targets === null) return 'unreachable'
  return state.targets.length === 0 ? 'no-targets' : null
}

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

/** Enough of an `UploadTask` to stop it. */
export interface Cancellable {
  cancelAsync: () => Promise<void>
}

/**
 * What to say when a batch has finished, or been called off.
 *
 * Split out to be tested, the same as `uploadBlocker` above and for the same reason: what this
 * says is the entirety of what anyone learns about an upload that did not go as asked, and it
 * is the kind of thing that is easy to get subtly wrong and never notice.
 *
 * A stopped batch is not a failed one. The file that was in flight when Stop was pressed does
 * come back as a failure — the transfer really did not complete — but reporting it as one would
 * be telling someone that the thing they just asked for went wrong.
 */
export function batchSummary(
  results: UploadOutcome[],
  stopped: boolean,
): { title: string; body: string } {
  const ok = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)

  if (stopped) {
    return {
      title: 'Upload stopped',
      body:
        ok.length === 0
          ? 'Nothing was uploaded.'
          : `${ok.length} ${ok.length === 1 ? 'file' : 'files'} had already finished and ${ok.length === 1 ? 'is' : 'are'} in your library.`,
    }
  }

  if (failed.length === 0) {
    return {
      title: ok.length === 1 ? 'Uploaded' : `${ok.length} uploaded`,
      body: 'Your server is indexing them now, so they may take a moment to appear. Pull down to refresh.',
    }
  }

  // Naming what was rejected and why: "3 skipped" alone leaves someone to guess whether it
  // was the file type, the size, or the connection.
  const detail = failed
    .slice(0, 5)
    .map((r) => `${r.name} — ${r.reason}`)
    .join('\n')
  const more = failed.length > 5 ? `\n…and ${failed.length - 5} more` : ''
  return {
    title: ok.length > 0 ? `${ok.length} uploaded, ${failed.length} skipped` : 'Nothing was uploaded',
    body: detail + more,
  }
}

/**
 * Upload one file to a repository. Sequential by design: these are photos and videos off a
 * phone camera, and several 2 GB transfers at once would compete for the same uplink and make
 * every one of them slower, with a progress bar that no longer means anything.
 *
 * `onTask` hands the caller the running transfer so it can be stopped. The Downloads tab has
 * had a Stop from the start, on the reasoning that a phone on a metered connection needs a way
 * out of a multi-gigabyte transfer it started by mistake; that argument is stronger going the
 * other way, since a phone's uplink is the slower half and picking the wrong thing out of a
 * camera roll takes one tap.
 */
export async function uploadFile(
  repositoryId: string,
  file: { uri: string; name: string; mimeType?: string | null },
  onProgress?: (fraction: number) => void,
  onTask?: (task: Cancellable) => void,
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

  onTask?.(task)

  const res = await task.uploadAsync()
  // expo resolves to undefined rather than rejecting when a transfer is cancelled, the same as
  // it does for downloads.
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
