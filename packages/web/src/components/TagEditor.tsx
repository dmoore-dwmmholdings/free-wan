import { useState } from 'react'
import type { Tag } from '@free-wan/shared'
import { useTags, useAddMediaTag, useRemoveMediaTag } from '../lib/tags'
import { CloseIcon, PlusIcon } from './icons'

/** Colored dot for a tag (falls back to the primary color). */
function Dot({ color }: { color: string | null }) {
  return <span className="h-2 w-2 flex-none rounded-full" style={{ background: color ?? 'var(--fw-primary)' }} />
}

/**
 * Add/remove tags on a media item. New names are created on the fly; existing tags autocomplete
 * from the library-wide set. Used on the Detail and Watch pages so any media type can be tagged.
 */
export function TagEditor({ mediaId, tags }: { mediaId: string; tags: Tag[] }) {
  const all = useTags()
  const add = useAddMediaTag(mediaId)
  const remove = useRemoveMediaTag(mediaId)
  const [value, setValue] = useState('')

  const has = new Set(tags.map((t) => t.id))
  const suggestions = (all.data?.data ?? []).filter((t) => !has.has(t.id))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = value.trim()
    if (!name || add.isPending) return
    add.mutate({ name })
    setValue('')
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="fw-mono-label">Tags</span>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => (
          <span key={t.id} className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pl-2.5 pr-1.5 text-[12.5px] text-ink">
            <Dot color={t.color} />
            {t.name}
            <button
              onClick={() => remove.mutate(t.id)}
              aria-label={`Remove tag ${t.name}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-red-400"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        <form onSubmit={submit} className="flex items-center">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            list="fw-tag-suggestions"
            placeholder="Add a tag…"
            className="h-8 w-[150px] rounded-full border border-line bg-transparent px-3 text-[12.5px] text-ink outline-none placeholder:text-muted focus:border-muted"
          />
          <datalist id="fw-tag-suggestions">
            {suggestions.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          {value.trim() && (
            <button type="submit" disabled={add.isPending} aria-label="Add tag" className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-primary hover:bg-surface-2">
              <PlusIcon className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
