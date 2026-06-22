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
    <div className="border-b border-neutral-900 px-6 pb-3 pt-1">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button
          onClick={() => onSelect(null)}
          className={categoryId ? 'text-neutral-400 hover:text-neutral-100' : 'font-medium text-brand'}
        >
          All folders
        </button>
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            <span className="text-neutral-600">/</span>
            <button
              onClick={() => onSelect(c.id)}
              className={
                i === crumbs.length - 1
                  ? 'font-medium text-brand'
                  : 'text-neutral-400 hover:text-neutral-100'
              }
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {kids.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {kids.map((k) => (
            <button
              key={k.id}
              onClick={() => onSelect(k.id)}
              className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 hover:border-brand hover:text-brand"
            >
              {k.name} <span className="text-neutral-500">· {k.itemCount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
