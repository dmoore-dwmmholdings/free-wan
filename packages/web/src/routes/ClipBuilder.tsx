import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import { PageShell } from '../components/AppLayout'
import { ScissorsIcon } from '../components/icons'
import { useMediaDetail, usePlayback } from '../lib/media'
import { useCreateClip } from '../lib/clips'

export function ClipBuilder() {
  const [params] = useSearchParams()
  const source = params.get('source') ?? ''
  const detail = useMediaDetail(source)
  const { data: playback } = usePlayback(source)
  const ref = useRef<HTMLVideoElement>(null)
  const create = useCreateClip()
  const navigate = useNavigate()
  const [inS, setInS] = useState(0)
  const [outS, setOutS] = useState(0)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const valid = outS > inS && name.trim().length > 0

  // Attach the source the same way the player does: direct-play sets src; HLS-only items
  // (non-web codecs) go through hls.js — a bare /stream src was unplayable for those.
  useEffect(() => {
    const v = ref.current
    if (!v || !playback) return
    if (playback.mode === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true })
      hls.loadSource(playback.url)
      hls.attachMedia(v)
      return () => hls.destroy()
    }
    v.src = playback.url
    return undefined
  }, [playback])

  async function save() {
    setError(null)
    if (!valid) {
      setError('Set an in-point, an out-point after it, and a name.')
      return
    }
    try {
      await create.mutateAsync({ sourceItemId: source, name: name.trim(), startS: inS, endS: outS })
      navigate('/clips')
    } catch {
      setError('Could not save clip.')
    }
  }

  return (
    <PageShell back={`/media/${source}`} trail={[{ label: 'Clips', to: '/clips' }, { label: 'Make a clip' }]}>
      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-6">
        <h1 className="font-head text-2xl font-semibold tracking-[-0.01em] text-ink">Make a clip</h1>
        {detail.data && <p className="mt-1 text-sm text-muted">from “{detail.data.title}”</p>}

        <video
          ref={ref}
          controls
          playsInline
          className="mt-4 w-full rounded-theme bg-black"
          onTimeUpdate={(e) => {
            // Live loop preview between the chosen in/out points.
            const v = e.currentTarget
            if (outS > inS && v.currentTime >= outS) v.currentTime = inS
          }}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <button onClick={() => setInS(ref.current?.currentTime ?? 0)} className="fw-btn-ghost h-9 px-3.5">
            Set in
          </button>
          <span className="font-mono tabular-nums text-muted">in {inS.toFixed(1)}s</span>
          <button onClick={() => setOutS(ref.current?.currentTime ?? 0)} className="fw-btn-ghost h-9 px-3.5">
            Set out
          </button>
          <span className="font-mono tabular-nums text-muted">out {outS.toFixed(1)}s</span>
          {outS > inS && <span className="font-mono text-primary">({(outS - inS).toFixed(1)}s)</span>}
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-4 flex gap-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Clip name…" className="fw-input flex-1" />
          <button onClick={save} disabled={!valid || create.isPending} className="fw-btn-primary h-11 px-5">
            <ScissorsIcon className="h-4 w-4" /> Save clip
          </button>
        </div>
      </main>
    </PageShell>
  )
}
