import { describe, expect, it } from 'vitest'
import { resumeSeek, shouldReport } from '@/lib/progress'

const state = (over: Partial<Parameters<typeof resumeSeek>[0]> = {}) => ({
  ready: true,
  pending: false,
  resumed: false,
  resumeAt: 300 as number | null,
  playedTo: 0,
  ...over,
})

describe('resumeSeek', () => {
  it('waits for the player to be ready', () => {
    // A seek issued before the source has loaded is thrown away, and there is no second
    // chance: this is the only thing that decides where playback starts.
    expect(resumeSeek(state({ ready: false }))).toBeNull()
  })

  it('waits for the server to answer', () => {
    // A downloaded file is ready to play before the request for its position has come back.
    expect(resumeSeek(state({ pending: true }))).toBeNull()
  })

  it('seeks to the remembered position once both are in', () => {
    expect(resumeSeek(state())).toEqual({ seekTo: 300 })
  })

  it('answers with the top of the video when there is nothing to resume', () => {
    // An answer, not a shrug. Offline the request fails and there is no position — and the
    // decision has still been made, or the position arriving later would move a viewer who
    // is by then some way into the video.
    expect(resumeSeek(state({ resumeAt: null }))).toEqual({ seekTo: null })
  })

  it('never decides twice', () => {
    // The defect this guards against: `/playback` is refetched on every return to the
    // foreground and reports the position this app itself last posted, which lags the real
    // playhead. Acting on it a second time is a jump backwards.
    expect(resumeSeek(state({ resumed: true, resumeAt: 900 }))).toBeNull()
    expect(resumeSeek(state({ resumed: true, resumeAt: null }))).toBeNull()
    expect(resumeSeek(state({ resumed: true, ready: false }))).toBeNull()
  })

  it('treats a position of zero as nothing to resume', () => {
    expect(resumeSeek(state({ resumeAt: 0 }))).toEqual({ seekTo: null })
  })
})

describe('resumeSeek once the viewer is already watching', () => {
  it('leaves someone who has started watching where they are', () => {
    // A downloaded file plays before a slow server answers. When the answer finally lands,
    // the viewer is a few seconds in and did not ask to go anywhere.
    expect(resumeSeek(state({ playedTo: 12 }))).toEqual({ seekTo: null })
  })

  it('still decides, so a later answer cannot try again', () => {
    // The screen records the decision, and the rule that it is made once does the rest.
    expect(resumeSeek(state({ playedTo: 12 }))).not.toBeNull()
  })

  it('still resumes when playback has barely begun', () => {
    // A healthy server answers in a fraction of a second, which is the ordinary case.
    expect(resumeSeek(state({ playedTo: 0.3 }))).toEqual({ seekTo: 300 })
  })
})

/**
 * Reports no longer come from a timer alone: every app-state transition triggers one, so that
 * an hour played with the phone locked is not recorded as the minute before it was locked.
 * That makes this guard load-bearing in a way it was not before — pulling down a notification
 * shade twice must not become two requests.
 */
describe('deciding whether a reading of the playhead is worth sending', () => {
  const last = (id: string, position: number) => ({ id, position })

  it('sends the first real position for an item', () => {
    expect(shouldReport({ id: 'a', position: 42, last: last('', -1) })).toBe(true)
  })

  it('says nothing before anyone has watched anything', () => {
    // Under five seconds is opening the screen, not watching it.
    expect(shouldReport({ id: 'a', position: 4.9, last: last('', -1) })).toBe(false)
    expect(shouldReport({ id: 'a', position: 0, last: last('', -1) })).toBe(false)
  })

  it('ignores a position that has not moved', () => {
    // Two transitions in a row — inactive, then active — read the same playhead.
    expect(shouldReport({ id: 'a', position: 300, last: last('a', 300) })).toBe(false)
    expect(shouldReport({ id: 'a', position: 300.4, last: last('a', 300) })).toBe(false)
  })

  it('sends once it has moved a second', () => {
    expect(shouldReport({ id: 'a', position: 301, last: last('a', 300) })).toBe(true)
  })

  it('sends when it moved backwards, which is a seek', () => {
    expect(shouldReport({ id: 'a', position: 30, last: last('a', 300) })).toBe(true)
  })

  it('never lets one item silence another', () => {
    // The defect this file already had: leaving one video at 300s and a second at 300.5s
    // within the same session dropped the second report, and with it the only record of
    // where that video had been watched to.
    expect(shouldReport({ id: 'b', position: 300.5, last: last('a', 300) })).toBe(true)
  })

  it('refuses a playhead that is not a number', () => {
    expect(shouldReport({ id: 'a', position: NaN, last: last('', -1) })).toBe(false)
    expect(shouldReport({ id: 'a', position: Infinity, last: last('', -1) })).toBe(false)
  })
})
