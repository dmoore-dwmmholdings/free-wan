import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageShell } from '../components/AppLayout'
import { VideoPlayer, type VideoPlayerHandle } from '../components/VideoPlayer'
import { LikeButton } from '../components/LikeButton'
import { TagEditor } from '../components/TagEditor'
import { AddToCollection } from '../components/AddToCollection'
import { PlayIcon, ScissorsIcon } from '../components/icons'
import { usePlayback, useMediaDetail, useInfiniteMediaList, formatDuration, resolutionLabel } from '../lib/media'

export function WatchPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data, isLoading, error } = usePlayback(id)
  const detail = useMediaDetail(id)
  // Videos only: photos in "Up next" would route to /watch/<photo>, which isn't playable.
  const list = useInfiniteMediaList('type=video')
  const playerRef = useRef<VideoPlayerHandle>(null)
  const [autoplay, setAutoplay] = useState(true)

  const m = detail.data
  const upNext = (list.data?.pages[0]?.data ?? []).filter((x) => x.id !== id).slice(0, 6)
  const res = m ? resolutionLabel(m.height) : ''
  const badges = [res, data?.mode === 'hls' ? 'TRANSCODE' : 'DIRECT-PLAY'].filter(Boolean) as string[]
  const specs = m
    ? [m.ext ? m.ext.toUpperCase() : m.container, m.videoCodec, m.audioCodec, m.width && m.height ? `${m.width}×${m.height}` : null, `${(m.sizeBytes / 1_000_000).toFixed(1)} MB`]
        .filter(Boolean)
        .join(' · ')
    : ''
  const trail = [
    ...(m?.categories.map((c) => ({ label: c.name, to: `/?category=${c.id}` })) ?? []),
    { label: m?.title ?? 'Watch' },
  ]

  return (
    <PageShell back="/" trail={trail}>
      <div className="flex flex-col gap-[22px] p-4 sm:p-[22px] lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
          {error ? (
            <p className="text-red-400">This item is temporarily unavailable.</p>
          ) : isLoading || !data ? (
            <div className="aspect-video w-full animate-pulse rounded-theme bg-surface" />
          ) : (
            <VideoPlayer
              ref={playerRef}
              id={id}
              descriptor={data}
              title={m?.title}
              badges={badges}
              onEnded={() => {
                if (autoplay && upNext[0]) navigate(`/watch/${upNext[0].id}`)
              }}
            />
          )}

          {m && (
            <div className="flex flex-wrap items-start gap-[18px]">
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <h1 className="font-head text-[21px] font-semibold tracking-[-0.01em] text-ink">{m.title}</h1>
                <div className="font-mono text-[11.5px] text-muted">{specs}</div>
                <div className="mt-1 flex flex-wrap gap-2.5">
                  <button onClick={() => playerRef.current?.play()} className="fw-btn-primary h-[38px] px-[18px] text-[13.5px]">
                    <PlayIcon className="h-4 w-4" /> Resume
                  </button>
                  <AddToCollection mediaItemId={m.id} />
                  <Link to={`/clips/new?source=${m.id}`} className="fw-btn-ghost h-[38px] px-[15px] text-[13px]">
                    <ScissorsIcon className="h-4 w-4" /> Make a clip
                  </Link>
                </div>
                <div className="mt-1.5">
                  <TagEditor mediaId={m.id} tags={m.tags} />
                </div>
              </div>
              <LikeButton id={m.id} liked={m.liked} likeCount={m.likeCount} variant="pill" />
            </div>
          )}
        </div>

        {/* Up next */}
        <aside className="flex w-full flex-none flex-col gap-3 lg:w-[320px]">
          <div className="flex items-center justify-between">
            <div className="font-head text-[15px] font-semibold text-ink">Up next</div>
            <button onClick={() => setAutoplay((a) => !a)} className="flex items-center gap-2 text-[11.5px] text-muted">
              Autoplay
              <span className="relative inline-block h-[15px] w-[26px] rounded-full" style={{ background: autoplay ? 'var(--fw-primary)' : 'var(--fw-surface-2)' }}>
                <span className="absolute top-0.5 h-[11px] w-[11px] rounded-full bg-white transition-all" style={{ left: autoplay ? '13px' : '2px' }} />
              </span>
            </button>
          </div>
          {upNext.map((u) => (
            <Link key={u.id} to={`/watch/${u.id}`} className="flex items-center gap-3 rounded-theme-sm p-[7px] transition hover:bg-surface-2">
              <div className="h-[62px] w-[104px] flex-none overflow-hidden rounded-theme-sm bg-surface-2">
                <img src={u.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="truncate text-[13px] font-semibold text-ink">{u.title}</div>
                <div className="font-mono text-[10.5px] text-muted">
                  {resolutionLabel(u.height)}
                  {u.durationS ? ` · ${formatDuration(u.durationS)}` : ''}
                </div>
              </div>
            </Link>
          ))}
        </aside>
      </div>
    </PageShell>
  )
}
