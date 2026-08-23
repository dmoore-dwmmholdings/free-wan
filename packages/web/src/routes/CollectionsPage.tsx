import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LibraryLayout } from '../components/AppLayout'
import { CollectionsIcon, PlusIcon } from '../components/icons'
import { useCollections, useCreateCollection, useDeleteCollection } from '../lib/social'

export function CollectionsPage() {
  const { data, isLoading } = useCollections()
  const create = useCreateCollection()
  const del = useDeleteCollection()
  const [name, setName] = useState('')

  return (
    <LibraryLayout>
      <div className="px-5 py-6 sm:px-[22px]">
        <div className="flex items-baseline gap-3">
          <h1 className="font-head text-[22px] font-semibold tracking-[-0.01em] text-ink">Collections</h1>
          <span className="font-mono text-[12px] text-muted">{data?.data.length ?? 0} collections</span>
        </div>

        <form
          className="mt-4 flex max-w-xl gap-2.5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            await create.mutateAsync({ name: name.trim() })
            setName('')
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New collection name…"
            className="fw-input flex-1"
          />
          <button type="submit" disabled={create.isPending} className="fw-btn-primary h-11 px-4">
            <PlusIcon className="h-4 w-4" /> Create
          </button>
        </form>

        <div className="mt-6">
          {isLoading ? (
            <p className="text-muted">Loading…</p>
          ) : data && data.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-[18px] sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
              {data.data.map((c) => (
                <div key={c.id} className="group flex flex-col gap-2.5">
                  <Link to={`/?collection=${c.id}`} className="relative block overflow-hidden rounded-theme-sm bg-surface-2" style={{ aspectRatio: '2 / 3' }}>
                    {c.coverUrl ? (
                      <img src={c.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-muted">
                        <CollectionsIcon className="h-8 w-8" />
                      </span>
                    )}
                  </Link>
                  <div className="flex items-start justify-between gap-2 px-px">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-ink">{c.name}</div>
                      <div className="text-[11px] text-muted">{c.itemCount} items</div>
                    </div>
                    <button
                      onClick={() => del.mutate(c.id)}
                      className="flex-none text-[11px] text-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-16 text-center text-muted">No collections yet. Create one above, then add items from any media page.</p>
          )}
        </div>
      </div>
    </LibraryLayout>
  )
}
