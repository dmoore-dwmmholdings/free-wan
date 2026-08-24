import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import type { VideoPlayer } from 'expo-video'
import { api } from './api'

const REPORT_INTERVAL_MS = 10_000

/** How far a position has to move before it is worth another request. */
const REPORT_MIN_DELTA_S = 1

/** Below this, someone has not watched anything yet and there is nothing to come back to. */
const REPORT_MIN_POSITION_S = 5

/**
 * Whether a reading of the playhead is worth sending.
 *
 * Split out because reports no longer arrive on a timer alone — leaving the app and coming back
 * both trigger one — and this is what keeps that from turning into a request every time a
 * notification shade is pulled down. It is also the whole of the rule that stopped one item's
 * position suppressing another's, which is a defect this file has already had once.
 */
export function shouldReport(state: {
  id: string
  position: number
  last: { id: string; position: number }
}): boolean {
  if (!Number.isFinite(state.position) || state.position < REPORT_MIN_POSITION_S) return false
  if (state.last.id !== state.id) return true
  return Math.abs(state.position - state.last.position) >= REPORT_MIN_DELTA_S
}

/**
 * Report playback position so the web app and this app resume at the same place.
 * Fire-and-forget: a phone off the tailnet must not surface an error mid-playback, and the
 * next successful report supersedes anything that was lost.
 *
 * Reported on a timer, on leaving the screen, and whenever the app changes state. That last one
 * is because two of this app's features meet badly without it. A video keeps playing when the
 * phone is locked — that is the point of `staysActiveInBackground` and the lock-screen
 * controls — while a JavaScript timer is not something a backgrounded app can count on. So an
 * hour listened to with the screen off could be reported as the minute before it was locked, and
 * picking the same video up on the web app would start it an hour early. `resumeSeek` below
 * already names this as a hazard and defends against its symptom; this is the same hole at its
 * source. Coming back to the foreground is the reading that matters, since it is taken after
 * whatever happened while away.
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
      if (!shouldReport({ id, position, last: lastSent.current })) return
      lastSent.current = { id, position }
      void api
        .post(`/api/media/${id}/progress`, {
          positionS: position,
          ...(durationS ? { durationS } : {}),
        })
        .catch(() => {})
    }

    const timer = setInterval(report, REPORT_INTERVAL_MS)
    // Every transition, not just backgrounding: the reading on the way out records where the
    // phone was locked, and the one on the way back records where playing on regardless got to.
    const appState = AppState.addEventListener('change', report)
    return () => {
      clearInterval(timer)
      appState.remove()
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
