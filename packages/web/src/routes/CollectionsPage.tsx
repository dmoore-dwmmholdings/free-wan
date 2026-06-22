import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { useCollections, useCreateCollection, useDeleteCollection } from '../lib/social'

export function CollectionsPage() {
  const { data, isLoading } = useCollections()
  const create = useCreateCollection()
  const del = useDeleteCollection()
  const [name, setName] = useState('')

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-6">
        <h1 className="text-2xl font-semibold">Collections</h1>

        <form
          className="mt-4 flex gap-2"
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
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Create
          </button>
        </form>

        <div className="mt-6">
          {isLoading ? (
            <p className="text-neutral-500">Loading…</p>
          ) : data && data.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {data.data.map((c) => (
                <div key={c.id} className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                  <Link to={`/?collection=${c.id}`} className="block">
                    <div className="aspect-video bg-neutral-800">
                      {c.coverUrl && <img src={c.coverUrl} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="truncate text-sm text-neutral-100">{c.name}</div>
                      <div className="text-xs text-neutral-500">{c.itemCount} items</div>
                    </div>
                  </Link>
                  <button
                    onClick={() => del.mutate(c.id)}
                    className="w-full border-t border-neutral-800 py-1 text-xs text-neutral-500 hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-12 text-center text-neutral-500">
              No collections yet. Create one above, then add items from any media page.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
