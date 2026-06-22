import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { MediaCard } from '@free-wan/shared'
import { AppHeader } from '../components/AppHeader'
import { LikeButton } from '../components/LikeButton'
import { GalleryViewer } from '../components/GalleryViewer'
import { CategoryBar } from '../components/CategoryBar'
import { UploadButton } from '../components/UploadButton'
import { useInfiniteMediaList, formatDuration, resolutionLabel } from '../lib/media'

function CardInner({ item }: { item: MediaCard }) {
  const [broken, setBroken] = useState(false)
  const dur = formatDuration(item.durationS)
  const res = resolutionLabel(item.height)
  return (
    <>
      <div className="relative aspect-video bg-neutral-800">
        {!broken && (
          <img
            src={item.posterUrl}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute left-1 top-1">
          <LikeButton id={item.id} liked={item.liked} likeCount={item.likeCount} />
        </div>
        <div className="absolute bottom-1 right-1 flex gap-1">
          {res && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{res}</span>}
          {dur && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{dur}</span>}
          {item.type === 'image' && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">IMG</span>
          )}
        </div>
      </div>
      <div className="truncate px-2 py-1.5 text-sm text-neutral-200" title={item.title}>
        {item.title}
      </div>
    </>
  )
}

const cardClass = 'group block overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-left transition hover:border-brand'

function Card({
  item,
  onOpenGallery,
  videosInGallery,
}: {
  item: MediaCard
  onOpenGallery: () => void
  videosInGallery: boolean
}) {
  // Images always open the full-screen gallery. In the Photos tab, videos do too (immersive
  // swipe-through, autoplay + loop). Elsewhere a video goes straight to the player (autoplay).
  if (item.type === 'image' || videosInGallery) {
    return (
      <button type="button" onClick={onOpenGallery} className={cardClass}>
        <CardInner item={item} />
      </button>
    )
  }
  return (
    <Link to={`/watch/${item.id}`} className={cardClass}>
      <CardInner item={item} />
    </Link>
  )
}

// The tabs split the library by *repository* type.
type Tab = 'all' | 'videos' | 'photos'
const PHOTO_TYPES = ['image', 'mixed']

function tabFromParams(repoTypes: string[]): Tab {
  if (repoTypes.length === 0) return 'all'
  if (repoTypes.length === 1 && repoTypes[0] === 'video') return 'videos'
  if (repoTypes.some((t) => PHOTO_TYPES.includes(t))) return 'photos'
  return 'all'
}

export function BrowsePage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')

  // Debounce the search box into the URL (URL is the source of truth — FR-22).
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params)
      if (q) next.set('q', q)
      else next.delete('q')
      if (next.toString() !== params.toString()) setParams(next, { replace: true })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const sort = params.get('sort') ?? 'added'
  const order = params.get('order') ?? 'desc'
  const type = params.get('type') ?? ''
  const repoTypes = params.getAll('repositoryType')
  const categoryId = params.get('category')
  const tab = tabFromParams(repoTypes)

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  // Switching tabs changes which folders exist, so reset the category selection.
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.delete('repositoryType')
    next.delete('category')
    if (t === 'videos') next.set('repositoryType', 'video')
    if (t === 'photos') for (const pt of PHOTO_TYPES) next.append('repositoryType', pt)
    setParams(next, { replace: true })
  }

  const selectCategory = (id: string | null) => setParam('category', id ?? '')

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteMediaList(params.toString())

  const items = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data])
  const total = data?.pages[0]?.total ?? 0
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage()
      },
      { rootMargin: '800px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const tabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? 'bg-brand text-white' : 'text-neutral-400 hover:text-neutral-100'
    }`

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your library…"
          className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
      </AppHeader>

      <div className="flex items-center gap-1 px-6 pt-3">
        <button onClick={() => setTab('all')} className={tabClass(tab === 'all')}>
          All
        </button>
        <button onClick={() => setTab('videos')} className={tabClass(tab === 'videos')}>
          Videos
        </button>
        <button onClick={() => setTab('photos')} className={tabClass(tab === 'photos')}>
          Photos
        </button>
      </div>

      <CategoryBar repositoryType={repoTypes} categoryId={categoryId} onSelect={selectCategory} />

      <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
        <select
          value={type}
          onChange={(e) => setParam('type', e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        >
          <option value="">All media</option>
          <option value="video">Video only</option>
          <option value="image">Images only</option>
        </select>
        <select
          value={`${sort}:${order}`}
          onChange={(e) => {
            const [s, o] = e.target.value.split(':')
            const next = new URLSearchParams(params)
            next.set('sort', s!)
            next.set('order', o!)
            setParams(next, { replace: true })
          }}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        >
          <option value="added:desc">Newest</option>
          <option value="added:asc">Oldest</option>
          <option value="title:asc">Title A–Z</option>
          <option value="title:desc">Title Z–A</option>
          <option value="duration:desc">Longest</option>
          <option value="duration:asc">Shortest</option>
          <option value="popularity:desc">Most liked</option>
        </select>
        <span className="text-neutral-500">{total} items</span>
        {tab === 'photos' && (
          <div className="ml-auto">
            <UploadButton />
          </div>
        )}
      </div>

      <main className="px-6 pb-12">
        {error ? (
          <p className="text-red-400">Failed to load library.</p>
        ) : isLoading ? (
          <p className="text-neutral-500">Loading…</p>
        ) : items.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((item, i) => (
                <Card
                  key={item.id}
                  item={item}
                  videosInGallery={tab === 'photos'}
                  onOpenGallery={() => setGalleryIndex(i)}
                />
              ))}
            </div>
            <div ref={sentinel} className="h-10" />
            {isFetchingNextPage && <p className="py-4 text-center text-sm text-neutral-500">Loading more…</p>}
            {hasNextPage && !isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <button
                  onClick={() => void fetchNextPage()}
                  className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-brand"
                >
                  Load more
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center text-neutral-500">
            <p>No media here.</p>
            <p className="mt-1 text-sm">
              {tab === 'all'
                ? 'An admin can add a repository and scan it to populate the library.'
                : 'Nothing in this tab yet — try another tab or check your repositories.'}
            </p>
          </div>
        )}
      </main>

      {galleryIndex !== null && items.length > 0 && (
        <GalleryViewer items={items} startIndex={galleryIndex} onClose={() => setGalleryIndex(null)} />
      )}
    </div>
  )
}
