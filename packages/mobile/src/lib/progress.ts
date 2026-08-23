import { useEffect, useRef } from 'react'
import type { VideoPlayer } from 'expo-video'
import { api } from './api'

const REPORT_INTERVAL_MS = 10_000

/**
 * Report playback position so the web app and this app resume at the same place.
 * Fire-and-forget: a phone off the tailnet must not surface an error mid-playback, and the
 * next successful report supersedes anything that was lost.
 */
export function useProgressReporter(id: string, player: VideoPlayer | null, durationS: number | null) {
  // Scoped to the item: this ref outlives a change of `id`, so a bare number let one item's
  // position suppress another's. Leaving a video at 300s and then leaving a second one at
  // 300.5s within the same session dropped the second report entirely, and with it the only
  // record of where that video had been watched to.
  const lastSent = useRef<{ id: string; position: number }>({ id: '', position: -1 })

  useEffect(() => {
    if (!player) return

    const report = () => {
      let position: number
      try {
        position = player.currentTime
      } catch {
        return // player already released
      }
      // Ignore the pre-roll and anything that has not moved since the last report.
      if (!Number.isFinite(position) || position < 5) return
      const previous = lastSent.current
      if (previous.id === id && Math.abs(position - previous.position) < 1) return
      lastSent.current = { id, position }
      void api
        .post(`/api/media/${id}/progress`, {
          positionS: position,
          ...(durationS ? { durationS } : {}),
        })
        .catch(() => {})
    }

    const timer = setInterval(report, REPORT_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      report() // capture the final position on leaving the screen
    }
  }, [player, id, durationS])
}

/**
 * How far into a video someone can be before resuming stops being a favour and starts being
 * an interruption.
 */
const RESUME_GRACE_S = 5

/**
 * Whether to seek the player to the position the server remembers, and where to.
 *
 * `null` means do nothing yet. An action means the resume has been decided, and the caller
 * must record that so this is never asked again: a `seekTo` of null is a real answer — start
 * at the top — not an absence of one.
 *
 * The rules exist for reasons that each cost something to find:
 *
 * - Wait for the player. A seek issued before the source has loaded is discarded.
 * - Wait for the server, but only until it has answered one way or the other. A streamed
 *   video cannot be ready first, because the URL being played comes from the same response;
 *   a downloaded one is ready as soon as the file opens, and offline that response never
 *   arrives at all.
 * - Decide once. `resumeAt` is the last position this app reported, and `/playback` is
 *   refetched every time the app returns to the foreground, so following its current value
 *   would drag the playhead back a reporting interval on every switch away and back — or the
 *   whole stretch of background playback, if the reporting timer was suspended while the
 *   audio kept going.
 */
export function resumeSeek(state: {
  ready: boolean
  pending: boolean
  resumed: boolean
  resumeAt: number | null
  /** Where the playhead has got to already, in seconds. */
  playedTo: number
}): { seekTo: number | null } | null {
  if (state.resumed || !state.ready || state.pending) return null
  // Waiting for the server has no time limit, and a downloaded file is ready to play long
  // before a slow one answers — so by the time the position arrives the viewer can already be
  // watching. Moving them then is worse than not resuming at all: they did not ask to go
  // anywhere, and whatever they were watching is what they chose. The decision is still made,
  // so a later answer cannot come back and try again.
  if (state.playedTo > RESUME_GRACE_S) return { seekTo: null }
  return { seekTo: state.resumeAt && state.resumeAt > 0 ? state.resumeAt : null }
}
