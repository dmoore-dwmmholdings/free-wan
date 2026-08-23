import { useNavigate, useSearchParams } from 'react-router-dom'
import { LibraryLayout } from '../components/AppLayout'
import { FolderIcon, ChevronRightIcon } from '../components/icons'
import { useCategoryChildren, useCategoryDetail } from '../lib/media'

/**
 * A dedicated folder browser. The "Categories" nav used to just re-open the library; this drills
 * through the folder tree (one level per click) and hands off to the filtered library when you pick
 * a folder to actually view. Drill state lives in the URL (`?parent=`) so Back works.
 */
export function CategoriesPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const parent = params.get('parent')

  const detail = useCategoryDetail(parent)
  const { data, isLoading } = useCategoryChildren(parent, [])
  const kids = data?.data ?? []
  const crumbs = detail.data ? [...detail.data.ancestors, { id: detail.data.id, name: detail.data.name }] : []

  const drill = (id: string | null) => {
    const next = new URLSearchParams()
    if (id) next.set('parent', id)
    setParams(next)
  }
  const viewItems = (id: string) => navigate(`/?category=${id}`)

  return (
    <LibraryLayout>
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-3 text-sm sm:px-[22px]">
        <button onClick={() => drill(null)} className={parent ? 'text-muted hover:text-ink' : 'font-semibold text-primary'}>
          All categories
        </button>
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <ChevronRightIcon className="h-3.5 w-3.5 text-muted opacity-60" />
            <button
              onClick={() => drill(c.id)}
              className={i === crumbs.length - 1 ? 'font-semibold text-primary' : 'text-muted hover:text-ink'}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-3 px-5 pb-3 pt-[18px] sm:px-[22px]">
        <h1 className="font-head text-[22px] font-semibold tracking-[-0.01em] text-ink">
          {detail.data ? detail.data.name : 'Categories'}
        </h1>
        {parent && detail.data && (
          <button onClick={() => viewItems(parent)} className="fw-btn-ghost h-8 px-3 text-[12.5px]">
            View {detail.data.itemCount.toLocaleString()} items
          </button>
        )}
      </div>

      {/* Folder grid */}
      <div className="px-5 pb-12 sm:px-[22px]">
        {isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : kids.length > 0 ? (
          <div className="grid grid-cols-2 gap-[18px] sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
            {kids.map((k) => (
              <button
                key={k.id}
                onClick={() => (k.hasChildren ? drill(k.id) : viewItems(k.id))}
                className="group flex items-center gap-3 rounded-theme-sm border border-line bg-surface p-3.5 text-left transition hover:-translate-y-[2px] hover:border-muted"
              >
                <span
                  className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-theme-sm text-primary"
                  style={{ background: 'var(--fw-primary-tint)' }}
                >
                  <FolderIcon className="h-[18px] w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink" title={k.name}>
                    {k.name}
                  </span>
                  <span className="block font-mono text-[10.5px] text-muted">{k.itemCount.toLocaleString()} items</span>
                </span>
                {k.hasChildren && <ChevronRightIcon className="h-4 w-4 flex-none text-muted" />}
              </button>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-muted">
            <p>No sub-folders here.</p>
            {parent && (
              <button onClick={() => viewItems(parent)} className="fw-btn-primary mt-3 h-9 px-4 text-[13px]">
                View its items
              </button>
            )}
          </div>
        )}
      </div>
    </LibraryLayout>
  )
}
