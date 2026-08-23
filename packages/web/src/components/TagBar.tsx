import { useTags } from '../lib/tags'

/**
 * Tag filter for the library. Selecting tags AND-combines them (an item must carry all selected
 * tags), so you can narrow into a subgroup-within-a-subgroup without folders. Mirrors CategoryBar.
 */
export function TagBar({ selected, onToggle, onClear }: { selected: string[]; onToggle: (id: string) => void; onClear: () => void }) {
  const { data } = useTags()
  const tags = data?.data ?? []
  if (tags.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 pb-3 pt-2.5 sm:px-[22px]">
      <span className="fw-mono-label mr-0.5">Tags</span>
      {tags.map((t) => {
        const active = selected.includes(t.id)
        return (
          <button key={t.id} onClick={() => onToggle(t.id)} className={`fw-chip ${active ? 'fw-chip-active' : 'hover:border-muted'}`}>
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: t.color ?? 'var(--fw-primary)' }} />
            {t.name}
            <span className="text-muted">· {t.itemCount}</span>
          </button>
        )
      })}
      {selected.length > 0 && (
        <button onClick={onClear} className="text-[12px] text-muted underline underline-offset-2 hover:text-ink">
          Clear
        </button>
      )}
    </div>
  )
}
