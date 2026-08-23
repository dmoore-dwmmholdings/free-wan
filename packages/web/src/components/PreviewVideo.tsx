import { useEffect, useRef, useState } from 'react'

const SNIPPET_S = 5 // length of each previewed snippet
const MAX_SNIPPETS = 6 // cap so a feature-length film still previews in well under a minute

/**
 * Evenly-spaced start times that walk chronologically across the whole video, each played for
 * SNIPPET_S seconds. A 2-minute clip becomes ~6 five-second peeks from start to end; anything too
 * short to chop just loops from the top.
 */
function snippetStarts(duration: number): number[] {
  const count = Math.min(MAX_SNIPPETS, Math.floor(duration / SNIPPET_S))
  if (!Number.isFinite(duration) || count < 2) return [0] // too short to chop — just loop it
  const last = Math.max(0, duration - SNIPPET_S)
  return Array.from({ length: count }, (_, i) => (i / (count - 1)) * last)
}

/**
 * A silent, auto-playing preview that stitches 5-second snippets from across the source video into
 * a little trailer. Mounted only while its card is the live one, so exactly one of these fetches at
 * a time. Always muted — previews never carry audio.
 */
export function PreviewVideo({ id, poster, className }: { id: string; poster: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const starts = useRef<number[]>([0])
  const idx = useRef(0)
  const [show, setShow] = useState(false) // fade in only once a real frame is on screen

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = true // belt-and-braces: the property (not just the attribute) unlocks autoplay
    void v.play().catch(() => {})
    return () => v.pause()
  }, [])

  return (
    <video
      ref={ref}
      src={`/api/media/${id}/stream`}
      poster={poster}
      muted
      playsInline
      preload="auto"
      className={`${className ?? ''} transition-opacity duration-500 ${show ? 'opacity-100' : 'opacity-0'}`}
      onLoadedMetadata={(e) => {
        starts.current = snippetStarts(e.currentTarget.duration)
        idx.current = 0
      }}
      onPlaying={() => setShow(true)}
      onTimeUpdate={(e) => {
        const v = e.currentTarget
        const s = starts.current
        const begin = s[idx.current] ?? 0
        const atEnd = v.currentTime >= (v.duration || Infinity) - 0.05
        // Multi-snippet: hop to the next chapter after 5s. Single (short video): just loop at the end.
        if ((s.length > 1 && v.currentTime >= begin + SNIPPET_S) || atEnd) {
          idx.current = (idx.current + 1) % s.length
          v.currentTime = s[idx.current] ?? 0
        }
      }}
    />
  )
}
