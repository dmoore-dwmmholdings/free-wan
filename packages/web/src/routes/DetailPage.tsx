import { Link, useParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { LikeButton } from '../components/LikeButton'
import { PlayIcon } from '../components/icons'
import { useMediaDetail, formatDuration, resolutionLabel } from '../lib/media'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex justify-between gap-4 border-b border-neutral-800 py-1.5 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right text-neutral-200">{value}</span>
    </div>
  )
}

export function DetailPage() {
  const { id = '' } = useParams()
  const { data: m, isLoading, error } = useMediaDetail(id)

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-6">
        <Link to="/" className="text-sm text-neutral-400 hover:text-white">
          Back to library
        </Link>

        {error ? (
          <p className="mt-6 text-red-400">Not found.</p>
        ) : isLoading || !m ? (
          <p className="mt-6 text-neutral-500">Loading…</p>
        ) : (
          <div className="mt-4">
            <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
              <img src={m.posterUrl} alt="" className="max-h-[60vh] w-full object-contain" />
            </div>

            <div className="mt-4 flex items-center gap-3">
              {m.type === 'video' && (
                <Link
                  to={`/watch/${m.id}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2 font-medium text-white hover:opacity-90"
                >
                  <PlayIcon className="h-4 w-4" />
                  Play
                </Link>
              )}
              {m.type === 'video' && (
                <Link
                  to={`/clips/new?source=${m.id}`}
                  className="inline-block rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-brand"
                >
                  Make a clip
                </Link>
              )}
              <LikeButton id={m.id} liked={m.liked} likeCount={m.likeCount} size="lg" />
            </div>

            <h1 className="mt-4 text-2xl font-semibold">{m.title}</h1>
            {m.categories.length > 0 && (
              <nav className="mt-1 flex flex-wrap gap-1 text-sm text-neutral-400">
                {m.categories.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && <span className="px-1 text-neutral-600">/</span>}
                    <Link to={`/?category=${c.id}`} className="hover:text-brand">
                      {c.name}
                    </Link>
                  </span>
                ))}
              </nav>
            )}

            <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2">
              <Row label="Type" value={m.type} />
              <Row label="Resolution" value={m.width && m.height ? `${m.width}×${m.height} (${resolutionLabel(m.height)})` : null} />
              <Row label="Duration" value={formatDuration(m.durationS)} />
              <Row label="Video codec" value={m.videoCodec} />
              <Row label="Audio codec" value={m.audioCodec} />
              <Row label="Container" value={m.container} />
              <Row label="Playback" value={m.playbackMode === 'direct' ? 'Direct play' : m.playbackMode === 'hls' ? 'Transcode (HLS)' : null} />
              <Row label="Captions" value={m.subtitles.length > 0 ? `${m.subtitles.length} track(s)` : null} />
              <Row label="Size" value={`${(m.sizeBytes / 1_000_000).toFixed(1)} MB`} />
              <Row label="Path" value={<code className="text-xs">{m.relPath}</code>} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
