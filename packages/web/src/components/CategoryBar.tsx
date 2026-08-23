import { useCategoryChildren, useCategoryDetail } from '../lib/media'

/**
 * Folder-derived category navigation: a breadcrumb of the current location plus chips for
 * its child folders. `repositoryType` scopes the tree to the active tab (Photos/Video).
 */
export function CategoryBar({
  repositoryType,
  categoryId,
  onSelect,
}: {
  repositoryType: string[]
  categoryId: string | null
  onSelect: (id: string | null) => void
}) {
  const detail = useCategoryDetail(categoryId)
  const children = useCategoryChildren(categoryId, repositoryType)

  const crumbs = detail.data
    ? [...detail.data.ancestors, { id: detail.data.id, name: detail.data.name }]
    : []
  const kids = children.data?.data ?? []

  // Nothing to navigate (no folders at this level and not drilled in): render nothing.
  if (!categoryId && kids.length === 0) return null

  return (
    <div className="border-b border-line px-5 pb-3 pt-2 sm:px-[22px]">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <button
          onClick={() => onSelect(null)}
          className={categoryId ? 'text-muted hover:text-ink' : 'font-semibold text-primary'}
        >
          All folders
        </button>
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span className="text-muted opacity-60">›</span>
            <button
              onClick={() => onSelect(c.id)}
              className={i === crumbs.length - 1 ? 'font-semibold text-primary' : 'text-muted hover:text-ink'}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {kids.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {kids.map((k) => (
            <button
              key={k.id}
              onClick={() => onSelect(k.id)}
              className="fw-chip hover:border-muted"
            >
              {k.name} <span className="text-muted">· {k.itemCount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
