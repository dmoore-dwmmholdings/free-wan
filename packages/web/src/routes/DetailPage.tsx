import { Link, useParams } from 'react-router-dom'
import { PageShell } from '../components/AppLayout'
import { LikeButton } from '../components/LikeButton'
import { TagEditor } from '../components/TagEditor'
import { PlayIcon, ScissorsIcon } from '../components/icons'
import { useMediaDetail, formatDuration, resolutionLabel } from '../lib/media'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right text-ink">{value}</span>
    </div>
  )
}

export function DetailPage() {
  const { id = '' } = useParams()
  const { data: m, isLoading, error } = useMediaDetail(id)
  const trail = [
    ...(m?.categories.map((c) => ({ label: c.name, to: `/?category=${c.id}` })) ?? []),
    { label: m?.title ?? 'Details' },
  ]

  return (
    <PageShell back="/" trail={trail}>
      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-6">
        {error ? (
          <p className="text-red-400">Not found.</p>
        ) : isLoading || !m ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <>
            <div className="fw-card overflow-hidden">
              <img src={m.posterUrl} alt="" className="max-h-[60vh] w-full bg-surface-2 object-contain" />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              {m.type === 'video' && (
                <Link to={`/watch/${m.id}`} className="fw-btn-primary h-[38px] px-[18px]">
                  <PlayIcon className="h-4 w-4" /> Play
                </Link>
              )}
              {m.type === 'video' && (
                <Link to={`/clips/new?source=${m.id}`} className="fw-btn-ghost h-[38px] px-[15px] text-[13px]">
                  <ScissorsIcon className="h-4 w-4" /> Make a clip
                </Link>
              )}
              <LikeButton id={m.id} liked={m.liked} likeCount={m.likeCount} variant="pill" />
            </div>

            <h1 className="mt-5 font-head text-2xl font-semibold tracking-[-0.01em] text-ink">{m.title}</h1>
            {m.categories.length > 0 && (
              <nav className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                {m.categories.map((c, i) => (
                  <span key={c.id} className="flex items-center gap-1.5">
                    {i > 0 && <span className="opacity-60">›</span>}
                    <Link to={`/?category=${c.id}`} className="hover:text-primary">
                      {c.name}
                    </Link>
                  </span>
                ))}
              </nav>
            )}

            <div className="mt-5">
              <TagEditor mediaId={m.id} tags={m.tags} />
            </div>

            <div className="fw-card mt-5 px-4 py-2">
              <Row label="Type" value={m.type} />
              <Row label="Resolution" value={m.width && m.height ? `${m.width}×${m.height} (${resolutionLabel(m.height)})` : null} />
              <Row label="Duration" value={formatDuration(m.durationS)} />
              <Row label="Video codec" value={m.videoCodec} />
              <Row label="Audio codec" value={m.audioCodec} />
              <Row label="Container" value={m.ext ? m.ext.toUpperCase() : m.container} />
              <Row label="Playback" value={m.playbackMode === 'direct' ? 'Direct play' : m.playbackMode === 'hls' ? 'Transcode (HLS)' : null} />
              <Row label="Captions" value={m.subtitles.length > 0 ? `${m.subtitles.length} track(s)` : null} />
              <Row label="Size" value={`${(m.sizeBytes / 1_000_000).toFixed(1)} MB`} />
              <Row label="Path" value={<code className="break-all font-mono text-xs">{m.relPath}</code>} />
            </div>
          </>
        )}
      </main>
    </PageShell>
  )
}
