import { useQuery } from '@tanstack/react-query'
import type { ClipDto, ClipPreview } from '@free-wan/shared'
import { api } from './api'

export function useClips() {
  return useQuery({
    queryKey: ['clips'],
    queryFn: () => api.get<{ data: ClipDto[] }>('/api/clips'),
  })
}

/** One clip, from the list query — the same shape the list already holds. */
export function useClip(id: string): ClipDto | undefined {
  const { data } = useClips()
  return data?.data.find((c) => c.id === id)
}

/** Where to play a clip from: the source stream, plus the in/out points. */
export function useClipPreview(id: string) {
  return useQuery({
    queryKey: ['clip-preview', id],
    queryFn: () => api.get<ClipPreview>(`/api/clips/${id}/preview`),
  })
}

/** What the player should be told when playback reaches a clip's out-point. */
export interface ClipCommand {
  /** Where to move the playhead. Always the in-point: a clip only ever rewinds to its start. */
  seekTo: number
  pause: boolean
}

/**
 * What to do at `currentTime`, or null to leave the player alone.
 *
 * A clip is a window onto a longer video and the player knows nothing about it, so the
 * out-point is held here. Both outcomes rewind: looping obviously, but stopping does too,
 * because leaving the playhead past the out-point means the next press of play is met with
 * another stop within a quarter of a second — the clip could be watched once and then never
 * again without hunting for the in-point on a scrubber that spans the whole source video.
 *
 * The server guarantees `endS > startS` on create and on update, so a clip cannot arrive with
 * a range that would rewind into its own end.
 */
export function clipCommandFor(
  currentTime: number,
  clip: { startS: number; endS: number; loop: boolean },
): ClipCommand | null {
  if (currentTime < clip.endS) return null
  return { seekTo: clip.startS, pause: !clip.loop }
}
