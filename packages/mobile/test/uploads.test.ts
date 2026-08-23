import { describe, expect, it } from 'vitest'
import { __test } from '@/lib/uploads'

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
