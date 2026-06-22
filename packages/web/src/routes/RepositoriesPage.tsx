import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { RepositoryDto, RepositoryType, RepositoryStatus } from '@free-wan/shared'
import { AppHeader } from '../components/AppHeader'
import { useMe } from '../lib/auth'
import { ApiError } from '../lib/api'
import {
  useRepositories,
  useCreateRepository,
  useUpdateRepository,
  useDeleteRepository,
  useScanRepository,
} from '../lib/repositories'

const TYPES: RepositoryType[] = ['video', 'image', 'mixed']

const STATUS_CLASS: Record<RepositoryStatus, string> = {
  online: 'bg-green-500/15 text-green-400',
  offline: 'bg-neutral-500/15 text-neutral-400',
  scanning: 'bg-blue-500/15 text-blue-400',
  error: 'bg-red-500/15 text-red-400',
  unknown: 'bg-neutral-500/15 text-neutral-400',
}

const inputClass =
  'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-brand'

function errMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong'
}

function AddRepositoryForm() {
  const create = useCreateRepository()
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [type, setType] = useState<RepositoryType>('mixed')
  const [readOnly, setReadOnly] = useState(true)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await create.mutateAsync({ name: name.trim(), rootPath: rootPath.trim(), type, readOnly })
      setName('')
      setRootPath('')
      setType('mixed')
      setReadOnly(true)
    } catch {
      /* error surfaced via create.error below */
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4"
    >
      <h2 className="text-sm font-medium text-neutral-200">Add a media library</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Point Free-WAN at a folder on the server to index. In Docker, this is the path{' '}
        <em>inside the container</em> (e.g. <code>/media/drive-a</code>), which you bind-mount in{' '}
        <code>docker-compose.yml</code>.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-300">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Movies"
            className={inputClass}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-300">Folder path</span>
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="/media/drive-a"
            className={`${inputClass} font-mono`}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-300">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as RepositoryType)}
            className={inputClass}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => setReadOnly(e.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          Read-only (recommended)
        </label>
      </div>
      {create.isError && (
        <p className="mt-3 text-sm text-red-400">{errMessage(create.error)}</p>
      )}
      <div className="mt-4">
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {create.isPending ? 'Adding…' : 'Add repository'}
        </button>
      </div>
    </form>
  )
}

function RepositoryRow({ repo }: { repo: RepositoryDto }) {
  const update = useUpdateRepository()
  const remove = useDeleteRepository()
  const scan = useScanRepository()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(repo.name)
  const [type, setType] = useState<RepositoryType>(repo.type)
  const [readOnly, setReadOnly] = useState(repo.readOnly)

  const saveEdit = async () => {
    await update.mutateAsync({ id: repo.id, body: { name: name.trim(), type, readOnly } })
    setEditing(false)
  }

  const onDelete = () => {
    if (
      window.confirm(
        `Remove "${repo.name}" from the library? This deletes its index entries only — your files on disk are untouched.`,
      )
    ) {
      remove.mutate(repo.id)
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-100">{repo.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_CLASS[repo.status]}`}>
              {repo.status}
            </span>
            {!repo.enabled && (
              <span className="rounded bg-neutral-700/40 px-1.5 py-0.5 text-xs text-neutral-400">
                disabled
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-neutral-500">{repo.rootPath}</div>
          <div className="mt-0.5 text-xs text-neutral-500">
            {repo.type} · {repo.itemCount} items · {repo.readOnly ? 'read-only' : 'writable'}
          </div>
          {repo.lastError && <div className="mt-1 text-xs text-red-400">{repo.lastError}</div>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 text-sm">
          <button
            onClick={() => scan.mutate({ id: repo.id })}
            disabled={scan.isPending}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:border-brand disabled:opacity-50"
          >
            Scan
          </button>
          <button
            onClick={() => update.mutate({ id: repo.id, body: { enabled: !repo.enabled } })}
            disabled={update.isPending}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:border-brand disabled:opacity-50"
          >
            {repo.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:border-brand"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            onClick={onDelete}
            disabled={remove.isPending}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-400">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-400">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RepositoryType)}
              className={inputClass}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(e) => setReadOnly(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            Read-only
          </label>
          <div className="sm:col-span-3">
            <button
              onClick={saveEdit}
              disabled={update.isPending}
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Save changes
            </button>
            <span className="ml-3 text-xs text-neutral-500">
              The folder path can’t be changed — remove and re-add to point elsewhere.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function RepositoriesPage() {
  const { data: me, isLoading: meLoading } = useMe()
  const { data, isLoading } = useRepositories()

  if (!meLoading && me && me.role !== 'admin') return <Navigate to="/" replace />

  const repos = data?.data ?? []

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-2xl font-semibold">Repositories</h1>
        <p className="mt-1 text-sm text-neutral-500">
          The media folders Free-WAN indexes. Add a folder, then run a scan to import what’s inside.
        </p>

        <AddRepositoryForm />

        <div className="mt-6">
          <h2 className="text-sm uppercase text-neutral-500">Configured libraries</h2>
          <div className="mt-2 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
            {isLoading ? (
              <p className="px-4 py-3 text-sm text-neutral-500">Loading…</p>
            ) : repos.length === 0 ? (
              <p className="px-4 py-3 text-sm text-neutral-500">
                No repositories yet — add one above to get started.
              </p>
            ) : (
              repos.map((r) => <RepositoryRow key={r.id} repo={r} />)
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
