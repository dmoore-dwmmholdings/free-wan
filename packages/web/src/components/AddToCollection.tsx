import { useEffect, useRef, useState } from 'react'
import { useAddToCollection, useCollections, useCreateCollection } from '../lib/social'
import { CheckIcon, PlusIcon } from './icons'

/**
 * "Add to collection" picker: a popover listing the caller's collections (click to add the
 * current media item) plus inline create-and-add. Replaces the old dead link to /collections,
 * which lost the media context entirely.
 */
export function AddToCollection({ mediaItemId }: { mediaItemId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)
  const { data } = useCollections()
  const create = useCreateCollection()
  const add = useAddToCollection()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  const addTo = async (collectionId: string) => {
    await add.mutateAsync({ collectionId, mediaItemId })
    setAddedTo((s) => new Set(s).add(collectionId))
  }

  const createAndAdd = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const c = await create.mutateAsync({ name: trimmed })
    setName('')
    await addTo(c.id)
  }

  const collections = data?.data ?? []

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="fw-btn-ghost h-[38px] px-[15px] text-[13px]">
        <PlusIcon className="h-4 w-4" /> Add to collection
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-64 rounded-theme border border-line bg-surface p-1.5 shadow-2xl">
          {collections.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-muted">No collections yet — create one below.</p>
          )}
          {collections.map((c) => {
            const added = addedTo.has(c.id)
            return (
              <button
                key={c.id}
                onClick={() => void addTo(c.id)}
                disabled={added}
                className="flex w-full items-center justify-between gap-2 rounded-theme-sm px-2.5 py-2 text-left text-sm text-ink hover:bg-surface-2 disabled:cursor-default"
              >
                <span className="truncate">{c.name}</span>
                {added ? (
                  <span className="flex flex-none items-center gap-1 text-xs text-accent">
                    <CheckIcon className="h-3.5 w-3.5" /> Added
                  </span>
                ) : (
                  <span className="flex-none font-mono text-[10.5px] text-muted">{c.itemCount}</span>
                )}
              </button>
            )
          })}
          <div className="my-1 h-px bg-line" />
          <div className="flex items-center gap-1.5 p-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createAndAdd()
              }}
              placeholder="New collection…"
              className="h-8 min-w-0 flex-1 rounded-theme-sm border border-line bg-bg px-2.5 text-[13px] text-ink outline-none placeholder:text-muted focus:border-primary"
            />
            <button
              onClick={() => void createAndAdd()}
              disabled={!name.trim() || create.isPending || add.isPending}
              className="fw-btn-primary h-8 px-3 text-xs"
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
