import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { MediaCard } from '@free-wan/shared'
import { LibraryLayout } from '../components/AppLayout'
import { LikeButton } from '../components/LikeButton'
import { GalleryViewer } from '../components/GalleryViewer'
import { CategoryBar } from '../components/CategoryBar'
import { TagBar } from '../components/TagBar'
import { UploadButton } from '../components/UploadButton'
import { PreviewVideo } from '../components/PreviewVideo'
import { useAutoplayCard } from '../components/AutoplayProvider'
import { ChevronDownIcon, CloseIcon } from '../components/icons'
import { useInfiniteMediaList, formatDuration, resolutionLabel } from '../lib/media'

function subtitle(item: MediaCard): string {
  if (item.categoryPath) return item.categoryPath.replace(/[\\/]+/g, ' · ')
  return item.type === 'image' ? 'Photo' : 'Video'
}

function Poster({ item }: { item: MediaCard }) {
  const [broken, setBroken] = useState(false)
  if (broken) return null
  return (
    <img
      src={item.posterUrl}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className="h-full w-full object-cover"
    />
  )
}

/** Video base layer: poster, plus a snippet-trailer preview once this card goes live. */
function VideoLayer({ item }: { item: MediaCard }) {
  const { active, setRef, hoverProps } = useAutoplayCard(item.id)
  return (
    <div ref={setRef} {...hoverProps} className="absolute inset-0">
      <Poster item={item} />
      {active && (
        <PreviewVideo
          id={item.id}
          poster={item.posterUrl}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  )
}

function CardInner({ item }: { item: MediaCard }) {
  const dur = formatDuration(item.durationS)
  const res = resolutionLabel(item.height)
  const isImage = item.type === 'image'
  return (
    <>
      <div className="relative aspect-[2/3] overflow-hidden rounded-theme-sm bg-surface-2">
        {isImage ? <Poster item={item} /> : <VideoLayer item={item} />}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/50" />
        {res && (
          <div className="absolute left-[7px] top-[7px] rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-wide text-white backdrop-blur-sm">
            {res}
          </div>
        )}
        <div className="absolute right-[5px] top-[5px] z-10">
          <LikeButton id={item.id} liked={item.liked} likeCount={item.likeCount} variant="card" />
        </div>
        <div className="absolute bottom-[7px] right-[7px] rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9.5px] text-white backdrop-blur-sm">
          {isImage ? 'PHOTO' : dur}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-px">
        <div className="truncate text-[13px] font-semibold text-ink" title={item.title}>
          {item.title}
        </div>
        <div className="truncate text-[11px] text-muted">{subtitle(item)}</div>
      </div>
    </>
  )
}

const cardClass = 'group flex cursor-pointer flex-col gap-2.5 text-left transition hover:-translate-y-[3px]'

function Card({
  item,
  onOpenGallery,
  videosInGallery,
}: {
  item: MediaCard
  onOpenGallery: () => void
  videosInGallery: boolean
}) {
  const navigate = useNavigate()
  // Images always open the full-screen gallery. In the Photos tab, videos do too (immersive
  // swipe-through, autoplay + loop). Elsewhere a video goes straight to the player (autoplay).
  // The card is a div (not a button/link) because it contains the LikeButton — nesting an
  // interactive element inside a button/anchor is invalid and breaks clicks.
  const open = () => (item.type === 'image' || videosInGallery ? onOpenGallery() : navigate(`/watch/${item.id}`))
  // The open control is a full-card overlay BUTTON that is a *sibling* of the LikeButton
  // (which sits above it via z-10) — nesting interactive elements is invalid ARIA.
  return (
    <div className={`${cardClass} relative`}>
      <button type="button" onClick={open} aria-label={`Open ${item.title}`} className="absolute inset-0 z-[1]" />
      <CardInner item={item} />
    </div>
  )
}

function PillSelect({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: ReactNode }) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-8 cursor-pointer appearance-none rounded-full border border-line bg-transparent pl-3 pr-7 text-[12.5px] text-ink outline-none hover:border-muted"
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
    </div>
  )
}

/** Column count for the card grid — mirrors the old tailwind classes
 *  (grid-cols-2 sm:3 md:4 lg:5 2xl:6) so the virtualized layout looks identical. */
function useGridColumns(): number {
  const calc = () => {
    const w = window.innerWidth
    if (w < 640) return 2
    if (w < 768) return 3
    if (w < 1024) return 4
    if (w < 1536) return 5
    return 6
  }
  const [cols, setCols] = useState(calc)
  useEffect(() => {
    const onResize = () => setCols(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return cols
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
  const tagIds = params.getAll('tag')
  const liked = params.get('liked') === 'true'
  const tab = tabFromParams(repoTypes)

  // Toggle a tag in the AND-filter (URL is the source of truth, like categories).
  const toggleTag = (tagId: string) => {
    const next = new URLSearchParams(params)
    const current = next.getAll('tag')
    next.delete('tag')
    for (const t of current.includes(tagId) ? current.filter((x) => x !== tagId) : [...current, tagId]) {
      next.append('tag', t)
    }
    setParams(next, { replace: true })
  }
  const clearTags = () => {
    const next = new URLSearchParams(params)
    next.delete('tag')
    setParams(next, { replace: true })
  }

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
  const filtered = !!(q || categoryId || liked || type || repoTypes.length || tagIds.length)

  // Windowed grid (NFR-01): only the visible rows (+overscan) are in the DOM, so scrolling a
  // 10k-item library doesn't accumulate thousands of cards. Rows are chunks of `cols` cards;
  // heights are measured (poster is aspect-locked, so estimate ≈ colWidth·1.5 + caption).
  const cols = useGridColumns()
  const rows = Math.ceil(items.length / cols)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useWindowVirtualizer({
    count: rows,
    overscan: 4,
    scrollMargin: gridRef.current?.offsetTop ?? 0,
    estimateSize: () => {
      const w = gridRef.current?.clientWidth ?? window.innerWidth
      const cardW = (w - (cols - 1) * 18) / cols
      return cardW * 1.5 + 46 + 18 // poster + caption + row gap
    },
  })

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

  const tabChip = (label: string, active: boolean, onClick: () => void) => (
    <button onClick={onClick} className={`fw-chip shrink-0 ${active ? 'fw-chip-active' : 'hover:border-muted'}`}>
      {label}
    </button>
  )

  return (
    <LibraryLayout
      search={{
        value: q,
        onChange: setQ,
        placeholder: total > 0 ? `Search ${total.toLocaleString()} items…` : 'Search your library…',
      }}
      headerRight={<UploadButton />}
    >
      {/* Filter bar — one horizontally scrollable row on phones (two wrapped rows ate too much
          vertical space); wraps normally from sm up. */}
      <div className="fw-hscroll flex min-h-[54px] items-center gap-2.5 overflow-x-auto border-b border-line px-5 py-2.5 sm:flex-wrap sm:overflow-x-visible sm:px-[22px]">
        {tabChip('All', tab === 'all', () => setTab('all'))}
        {tabChip('Video', tab === 'videos', () => setTab('videos'))}
        {tabChip('Photos', tab === 'photos', () => setTab('photos'))}
        <button
          onClick={() => setParam('liked', liked ? '' : 'true')}
          className={`fw-chip shrink-0 whitespace-nowrap ${liked ? 'fw-chip-active' : 'hover:border-muted'}`}
        >
          Liked by me{liked && <CloseIcon className="h-3 w-3 opacity-80" />}
        </button>
        <div className="flex-1" />
        <PillSelect label="Media type" value={type} onChange={(v) => setParam('type', v)}>
          <option value="">All types</option>
          <option value="video">Video only</option>
          <option value="image">Images only</option>
        </PillSelect>
        <PillSelect
          label="Sort by"
          value={`${sort}:${order}`}
          onChange={(v) => {
            const [s, o] = v.split(':')
            const next = new URLSearchParams(params)
            next.set('sort', s!)
            next.set('order', o!)
            setParams(next, { replace: true })
          }}
        >
          <option value="added:desc">Newest</option>
          <option value="added:asc">Oldest</option>
          <option value="title:asc">Title A–Z</option>
          <option value="title:desc">Title Z–A</option>
          <option value="duration:desc">Longest</option>
          <option value="duration:asc">Shortest</option>
          <option value="popularity:desc">Most liked</option>
        </PillSelect>
      </div>

      <CategoryBar repositoryType={repoTypes} categoryId={categoryId} onSelect={selectCategory} />
      <TagBar selected={tagIds} onToggle={toggleTag} onClear={clearTags} />

      {/* Header */}
      <div className="flex items-baseline gap-3 px-5 pb-3 pt-[18px] sm:px-[22px]">
        <h1 className="font-head text-[22px] font-semibold tracking-[-0.01em] text-ink">
          {liked ? 'Liked' : 'Library'}
        </h1>
        <span className="font-mono text-[12px] text-muted">
          {total.toLocaleString()} items{filtered ? ' · filtered' : ''}
        </span>
      </div>

      {/* Grid */}
      <div className="px-5 pb-12 sm:px-[22px]">
        {error ? (
          <p className="text-red-400">Failed to load library.</p>
        ) : isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : items.length > 0 ? (
          <>
            <div ref={gridRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    gap: 18,
                    paddingBottom: 18,
                  }}
                >
                  {items.slice(row.index * cols, row.index * cols + cols).map((item, colIdx) => (
                    <Card
                      key={item.id}
                      item={item}
                      videosInGallery={tab === 'photos'}
                      onOpenGallery={() => setGalleryIndex(row.index * cols + colIdx)}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div ref={sentinel} className="h-10" />
            {isFetchingNextPage && <p className="py-4 text-center text-sm text-muted">Loading more…</p>}
            {hasNextPage && !isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <button onClick={() => void fetchNextPage()} className="fw-btn-ghost h-9 px-4">
                  Load more
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center text-muted">
            <p>No media here.</p>
            <p className="mt-1 text-sm">
              {tab === 'all'
                ? 'An admin can add a repository and scan it to populate the library.'
                : 'Nothing in this tab yet — try another tab or check your repositories.'}
            </p>
          </div>
        )}
      </div>

      {galleryIndex !== null && items.length > 0 && (
        <GalleryViewer items={items} startIndex={galleryIndex} onClose={() => setGalleryIndex(null)} />
      )}
    </LibraryLayout>
  )
}
