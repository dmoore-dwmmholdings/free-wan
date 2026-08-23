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
