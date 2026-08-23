import { describe, expect, it } from 'vitest'
import { __test, fileNameFor, uploadBlocker } from '@/lib/uploads'

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
