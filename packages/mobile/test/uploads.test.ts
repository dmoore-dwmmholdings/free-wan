import { describe, expect, it, vi } from 'vitest'
import { __test, batchSummary, fileNameFor, uploadBlocker } from '@/lib/uploads'

const { outcomeFor } = __test

describe('reading the server upload response', () => {
  it('reports the name the server actually saved, not the one sent', () => {
    // The route de-duplicates: a second IMG_0001.jpg lands as "IMG_0001 (1).jpg". Telling the
    // user the name they sent would send them looking for a file under the wrong name.
    const outcome = outcomeFor('IMG_0001.jpg', { files: ['IMG_0001 (1).jpg'], skipped: [] })
    expect(outcome).toEqual({ name: 'IMG_0001 (1).jpg', ok: true })
  })

  it('carries the reason a file was rejected', () => {
    const outcome = outcomeFor('notes.txt', {
      files: [],
      skipped: [{ name: 'notes.txt', reason: 'unsupported file type' }],
    })
    expect(outcome).toEqual({ name: 'notes.txt', ok: false, reason: 'unsupported file type' })
  })

  it('does not claim success when the server saved nothing and gave no reason', () => {
    // A 422 with an empty body would otherwise read as "uploaded" — the worst possible
    // outcome, because the user stops watching for the file to appear.
    const outcome = outcomeFor('clip.mov', {})
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBeTruthy()
  })

  it('ignores a skipped entry belonging to a different file', () => {
    const outcome = outcomeFor('a.jpg', {
      files: ['a.jpg'],
      skipped: [{ name: 'b.txt', reason: 'unsupported file type' }],
    })
    expect(outcome).toEqual({ name: 'a.jpg', ok: true })
  })
})

describe('naming a file the picker returned', () => {
  it('uses the name the picker gave when there is one', () => {
    expect(fileNameFor({ uri: 'file:///var/x/ABC.HEIC', fileName: 'Holiday.HEIC' }, 0)).toBe(
      'Holiday.HEIC',
    )
  })

  it('falls back when the name is missing or blank', () => {
    // `??` alone would keep an empty string and send a file with no name at all.
    expect(fileNameFor({ uri: 'file:///var/x/ABC.heic', fileName: '' }, 0)).toBe('upload-1.heic')
    expect(fileNameFor({ uri: 'file:///var/x/ABC.heic', fileName: '   ' }, 0)).toBe('upload-1.heic')
    expect(fileNameFor({ uri: 'file:///var/x/ABC.heic', fileName: null }, 0)).toBe('upload-1.heic')
    expect(fileNameFor({ uri: 'file:///var/x/ABC.heic' }, 0)).toBe('upload-1.heic')
  })

  it('takes the extension from the URI, lowercased', () => {
    expect(fileNameFor({ uri: 'file:///var/x/ABC.HEIC' }, 0)).toBe('upload-1.heic')
  })

  it('handles a content:// URI, which carries no extension at all', () => {
    // The previous version produced "upload-1.content://media/external/images/media/1234",
    // because String.split('.').pop() returns the whole string when there is no dot — which
    // also meant the intended `?? 'jpg'` fallback could never run.
    expect(fileNameFor({ uri: 'content://media/external/images/media/1234' }, 0)).toBe(
      'upload-1.jpg',
    )
  })

  it('ignores a query string or fragment', () => {
    expect(fileNameFor({ uri: 'file:///x.jpg?width=100' }, 0)).toBe('upload-1.jpg')
    expect(fileNameFor({ uri: 'file:///x.jpg#frag' }, 0)).toBe('upload-1.jpg')
  })

  it('ignores a dot that is in a directory rather than the file', () => {
    expect(fileNameFor({ uri: 'file:///my.folder/IMG1234' }, 0)).toBe('upload-1.jpg')
  })

  it('rejects a trailing segment that is not extension-shaped', () => {
    expect(fileNameFor({ uri: 'file:///x/archive.tar.gzipped' }, 0)).toBe('upload-1.jpg')
  })

  it('defaults by media type when the URI says nothing', () => {
    expect(fileNameFor({ uri: 'content://x/1', type: 'video' }, 0)).toBe('upload-1.mp4')
    // The movie half of a live photo is still a video.
    expect(fileNameFor({ uri: 'content://x/1', type: 'pairedVideo' }, 0)).toBe('upload-1.mp4')
    expect(fileNameFor({ uri: 'content://x/1', type: 'image' }, 0)).toBe('upload-1.jpg')
  })

  it('keeps unnamed files in one batch distinct', () => {
    // Sharing a name would make the outcome summary undercount.
    const names = [0, 1, 2].map((i) => fileNameFor({ uri: 'content://x/1' }, i))
    expect(new Set(names).size).toBe(3)
  })
})

describe('what stops the upload button opening the picker', () => {
  const target = { id: 'r1', name: 'Family video', type: 'video' as const }

  it('says nothing while the answer is still coming', () => {
    expect(uploadBlocker({ loading: true, targets: null })).toBe('loading')
  })

  it('separates a server that did not answer from one with nowhere to put files', () => {
    // The distinction is the point. "No library on your server accepts uploads" is a claim
    // about the server, and a request that failed supports no claim about it at all — the
    // same lie an empty state tells when it stands in for an unreachable server.
    expect(uploadBlocker({ loading: false, targets: null })).toBe('unreachable')
    expect(uploadBlocker({ loading: false, targets: [] })).toBe('no-targets')
  })

  it('lets the picker open when there is somewhere to put things', () => {
    expect(uploadBlocker({ loading: false, targets: [target] })).toBeNull()
  })
})

/**
 * What a batch says when it ends. Uploads can now be stopped mid-batch, and a stop is not a
 * failure — the file that was in flight really did not finish, but telling someone that the
 * thing they just asked for went wrong is the kind of small lie this app keeps refusing to tell.
 */
describe('what to say when a batch of uploads ends', () => {
  const ok = (name: string) => ({ name, ok: true as const })
  const bad = (name: string, reason: string) => ({ name, ok: false as const, reason })

  it('reports plain success without listing anything', () => {
    const summary = batchSummary([ok('a.jpg'), ok('b.jpg')], false)
    expect(summary.title).toBe('2 uploaded')
    expect(summary.body).toContain('Pull down to refresh')
  })

  it('counts one file in the singular', () => {
    expect(batchSummary([ok('a.jpg')], false).title).toBe('Uploaded')
  })

  it('names what was rejected and why', () => {
    // "3 skipped" alone leaves someone guessing between the file type, the size and the link.
    const summary = batchSummary([ok('a.jpg'), bad('b.txt', 'unsupported file type')], false)
    expect(summary.title).toBe('1 uploaded, 1 skipped')
    expect(summary.body).toBe('b.txt \u2014 unsupported file type')
  })

  it('lists at most five, and says how many more', () => {
    const summary = batchSummary(
      Array.from({ length: 8 }, (_, i) => bad(`f${i}.txt`, 'unsupported file type')),
      false,
    )
    expect(summary.title).toBe('Nothing was uploaded')
    expect(summary.body.split('\n')).toHaveLength(6)
    expect(summary.body).toContain('3 more')
  })

  it('calls a stop a stop, not a failure', () => {
    // The in-flight file arrives here as a failure and must not be listed as one.
    const summary = batchSummary([ok('a.jpg')], true)
    expect(summary.title).toBe('Upload stopped')
    expect(summary.body).toContain('1 file had already finished')
    expect(summary.body).not.toContain('skipped')
  })

  it('says plainly when a stop caught everything', () => {
    expect(batchSummary([], true)).toEqual({
      title: 'Upload stopped',
      body: 'Nothing was uploaded.',
    })
  })

  it('reports a stop as a stop even when files really did fail before it', () => {
    // Otherwise pressing Stop would produce a list of failures, one of which is the stop.
    const summary = batchSummary([ok('a.jpg'), bad('b.txt', 'unsupported file type')], true)
    expect(summary.title).toBe('Upload stopped')
  })
})

/**
 * `uploadFile` itself, which until now had no test at all: the filesystem stub was missing
 * `createUploadTask` and `FileSystemUploadType`, and both reach it through a namespace import,
 * so they arrived as `undefined` and nothing complained because nothing ever called them.
 *
 * It matters more than most of this file. It reads the server's own answer rather than
 * inferring one, it treats 202 and 422 as answers and everything else as an error, and it hands
 * the running transfer back so the Stop control has something to act on.
 */
describe('sending one file', () => {
  async function fresh() {
    vi.resetModules()
    const fs = await import('./stubs/expo-file-system')
    fs.__uploads.reset()
    const session = await import('@/lib/session')
    await session.saveSession('https://media.example.com', 'token-abc')
    const uploads = await import('@/lib/uploads')
    return { fs, uploads }
  }
  const FILE = { uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' }

  it('sends it to the repository, authenticated, as multipart', async () => {
    const { fs, uploads } = await fresh()
    await uploads.uploadFile('repo-1', FILE)

    const call = fs.__uploads.calls[0]!
    expect(call.url).toBe('https://media.example.com/api/repositories/repo-1/upload')
    expect(call.fileUri).toBe('file:///photo.jpg')
    expect(call.options.uploadType).toBe('multipart')
    expect(call.options.headers).toMatchObject({ authorization: 'Bearer token-abc' })
  })

  it('reports the name the server saved, which is not always the one sent', async () => {
    // Uploading IMG_0001.jpg twice leaves the second as "IMG_0001 (1).jpg".
    const { fs, uploads } = await fresh()
    fs.__uploads.reply(202, { files: ['IMG_0001 (1).jpg'], skipped: [] })
    await expect(uploads.uploadFile('repo-1', { ...FILE, name: 'IMG_0001.jpg' })).resolves.toEqual({
      name: 'IMG_0001 (1).jpg',
      ok: true,
    })
  })

  it('treats a 422 as an answer, with the server’s reason', async () => {
    // Every file rejected. That is the route reporting, not the request failing.
    const { fs, uploads } = await fresh()
    fs.__uploads.reply(422, { files: [], skipped: [{ name: 'clip.avi', reason: 'unsupported file type' }] })
    await expect(uploads.uploadFile('repo-1', { ...FILE, name: 'clip.avi' })).resolves.toEqual({
      name: 'clip.avi',
      ok: false,
      reason: 'unsupported file type',
    })
  })

  it('throws on a status that is neither', async () => {
    const { fs, uploads } = await fresh()
    fs.__uploads.reply(500, 'upstream exploded')
    await expect(uploads.uploadFile('repo-1', FILE)).rejects.toThrow(/HTTP 500/)
  })

  it('throws when the answer is not JSON, rather than reporting a false success', async () => {
    // A proxy in front of the server answers with HTML; parsing it would bury the real problem.
    const { fs, uploads } = await fresh()
    fs.__uploads.reply(202, '<html>Gateway Timeout</html>')
    await expect(uploads.uploadFile('repo-1', FILE)).rejects.toThrow(/could not read/)
  })

  it('leaves out a mime type the picker did not know', async () => {
    // The route falls back to the extension, so an unknown type is better absent than guessed.
    const { fs, uploads } = await fresh()
    await uploads.uploadFile('repo-1', { uri: 'file:///x', name: 'x.jpg', mimeType: null })
    expect('mimeType' in fs.__uploads.calls[0]!.options).toBe(false)
  })

  it('reports progress as a fraction', async () => {
    const { uploads } = await fresh()
    const seen: number[] = []
    await uploads.uploadFile('repo-1', FILE, (f) => seen.push(f))
    expect(seen).toEqual([0.5, 1])
  })

  it('hands the running transfer back, which is what Stop acts on', async () => {
    // Without this the upload could not be stopped at all — the task stayed inside uploadFile.
    const { fs, uploads } = await fresh()
    const release = fs.__uploads.hold()
    let task: { cancelAsync: () => Promise<void> } | null = null
    const pending = uploads.uploadFile('repo-1', FILE, undefined, (t) => {
      task = t
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(task).not.toBeNull()
    await task!.cancelAsync()
    // A cancelled transfer resolves to undefined, which uploadFile turns into a throw for the
    // batch loop to recognise.
    await expect(pending).rejects.toThrow(/cancelled/i)
    release()
  })
})
