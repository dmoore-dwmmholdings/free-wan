import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, Link } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { UpdatePanel } from '../components/UpdatePanel'
import { useMe } from '../lib/auth'
import { api } from '../lib/api'

interface SystemInfo {
  version: string
  node: string
  ffmpeg: string | null
  uptimeS: number
  repositories: Array<{ id: string; name: string; status: string; itemCount: number }>
  cache: { thumbsBytes: number; hlsBytes: number; exportsBytes: number }
  queue: { queued: number; running: number }
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-xs uppercase text-neutral-500">{label}</div>
      <div className="mt-1 text-sm text-neutral-100">{value}</div>
    </div>
  )
}

export function SystemPage() {
  const { data: me, isLoading: meLoading } = useMe()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/api/admin/system'), refetchInterval: 5000 })
  const clearCache = useMutation({
    mutationFn: () => api.post('/api/admin/cache/transcode/clear'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system'] }),
  })

  if (!meLoading && me && me.role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-2xl font-semibold">System</h1>
        {!data ? (
          <p className="mt-4 text-neutral-500">Loading…</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="App version" value={data.version} />
              <Stat label="Node" value={data.node} />
              <Stat label="ffmpeg" value={data.ffmpeg ?? 'unavailable'} />
              <Stat label="Uptime" value={`${Math.floor(data.uptimeS / 60)} min`} />
              <Stat label="Queue" value={`${data.queue.queued} queued · ${data.queue.running} running`} />
              <Stat label="Thumbs cache" value={mb(data.cache.thumbsBytes)} />
              <Stat label="HLS cache" value={mb(data.cache.hlsBytes)} />
              <Stat label="Exports" value={mb(data.cache.exportsBytes)} />
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm uppercase text-neutral-500">Repositories</h2>
                <Link to="/settings/repositories" className="text-sm text-brand hover:underline">
                  Manage
                </Link>
              </div>
              <div className="mt-2 divide-y divide-neutral-800 rounded-lg border border-neutral-800">
                {data.repositories.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-neutral-500">No repositories.</p>
                ) : (
                  data.repositories.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span>{r.name}</span>
                      <span className="text-neutral-400">
                        {r.itemCount} items · <span className="text-neutral-300">{r.status}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <UpdatePanel />

            <button
              onClick={() => clearCache.mutate()}
              disabled={clearCache.isPending}
              className="mt-6 rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-brand disabled:opacity-50"
            >
              Clear transcode (HLS) cache
            </button>
          </>
        )}
      </main>
    </div>
  )
}
