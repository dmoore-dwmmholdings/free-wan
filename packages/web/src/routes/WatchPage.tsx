import { Link, useParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { VideoPlayer } from '../components/VideoPlayer'
import { usePlayback, useMediaDetail } from '../lib/media'

export function WatchPage() {
  const { id = '' } = useParams()
  const { data, isLoading, error } = usePlayback(id)
  const detail = useMediaDetail(id)

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 py-6">
        <div className="flex gap-4 text-sm text-neutral-400">
          <Link to="/" className="hover:text-white">
            Back to library
          </Link>
          <Link to={`/media/${id}`} className="hover:text-white">
            Details
          </Link>
        </div>
        <div className="mt-4">
          {error ? (
            <p className="text-red-400">This item is temporarily unavailable.</p>
          ) : isLoading || !data ? (
            <p className="text-neutral-500">Loading…</p>
          ) : (
            <VideoPlayer id={id} descriptor={data} />
          )}
          {detail.data && <h1 className="mt-4 text-2xl font-semibold">{detail.data.title}</h1>}
        </div>
      </main>
    </div>
  )
}
