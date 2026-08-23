import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, Link } from 'react-router-dom'
import { PageShell } from '../components/AppLayout'
import { AdminTabs } from '../components/AdminTabs'
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
    <div className="fw-card px-4 py-3">
      <div className="fw-mono-label">{label}</div>
      <div className="mt-1.5 text-sm text-ink">{value}</div>
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
    <PageShell home trail={[{ label: 'Admin' }, { label: 'System' }]}>
      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-6">
        <h1 className="font-head text-2xl font-semibold tracking-[-0.01em] text-ink">System</h1>
        <AdminTabs />
        {!data ? (
          <p className="mt-4 text-muted">Loading…</p>
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
                <h2 className="fw-mono-label">Repositories</h2>
                <Link to="/settings/repositories" className="text-sm font-medium text-primary-strong hover:underline">
                  Manage
                </Link>
              </div>
              <div className="fw-card mt-2 divide-y divide-line">
                {data.repositories.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted">No repositories.</p>
                ) : (
                  data.repositories.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-ink">{r.name}</span>
                      <span className="font-mono text-xs text-muted">
                        {r.itemCount} items · <span className="text-ink">{r.status}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <UpdatePanel />

            <button onClick={() => clearCache.mutate()} disabled={clearCache.isPending} className="fw-btn-ghost mt-6 h-10 px-4">
              Clear transcode (HLS) cache
            </button>
          </>
        )}
      </main>
    </PageShell>
  )
}
