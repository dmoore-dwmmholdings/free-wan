import { describe, expect, it } from 'vitest'
import { resumeSeek } from '@/lib/progress'

const state = (over: Partial<Parameters<typeof resumeSeek>[0]> = {}) => ({
  ready: true,
  pending: false,
  resumed: false,
  resumeAt: 300 as number | null,
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
