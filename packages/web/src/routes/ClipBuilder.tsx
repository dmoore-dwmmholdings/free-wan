import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { useMediaDetail } from '../lib/media'
import { useCreateClip } from '../lib/clips'

export function ClipBuilder() {
  const [params] = useSearchParams()
  const source = params.get('source') ?? ''
  const detail = useMediaDetail(source)
  const ref = useRef<HTMLVideoElement>(null)
  const create = useCreateClip()
  const navigate = useNavigate()
  const [inS, setInS] = useState(0)
  const [outS, setOutS] = useState(0)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const valid = outS > inS && name.trim().length > 0

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
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-6">
        <Link to={`/media/${source}`} className="text-sm text-neutral-400 hover:text-white">
          Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Make a clip</h1>
        {detail.data && <p className="text-sm text-neutral-500">from “{detail.data.title}”</p>}

        <video
          ref={ref}
          src={`/api/media/${source}/stream`}
          controls
          playsInline
          className="mt-4 w-full rounded-xl bg-black"
          onTimeUpdate={(e) => {
            // Live loop preview between the chosen in/out points.
            const v = e.currentTarget
            if (outS > inS && v.currentTime >= outS) v.currentTime = inS
          }}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <button onClick={() => setInS(ref.current?.currentTime ?? 0)} className="rounded border border-neutral-700 px-3 py-1.5 hover:border-brand">
            Set in
          </button>
          <span className="tabular-nums text-neutral-400">in {inS.toFixed(1)}s</span>
          <button onClick={() => setOutS(ref.current?.currentTime ?? 0)} className="rounded border border-neutral-700 px-3 py-1.5 hover:border-brand">
            Set out
          </button>
          <span className="tabular-nums text-neutral-400">out {outS.toFixed(1)}s</span>
          {outS > inS && <span className="text-neutral-500">({(outS - inS).toFixed(1)}s)</span>}
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Clip name…"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={save}
            disabled={!valid || create.isPending}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Save clip
          </button>
        </div>
      </main>
    </div>
  )
}
