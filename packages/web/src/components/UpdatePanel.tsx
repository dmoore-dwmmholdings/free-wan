import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'
import { useUpdates, useUploadUpdate, type UpdateHistoryItem, type UpdatesInfo } from '../lib/updates'
import { UploadIcon } from './icons'

const STATUS_LABEL: Record<UpdateHistoryItem['status'], string> = {
  applying: 'Applying',
  pending_restart: 'Restarting',
  success: 'Installed',
  failed: 'Failed',
  rolled_back: 'Rolled back',
}
const STATUS_CLASS: Record<UpdateHistoryItem['status'], string> = {
  applying: 'text-primary',
  pending_restart: 'text-primary',
  success: 'text-accent',
  failed: 'text-red-400',
  rolled_back: 'text-amber-400',
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

export function UpdatePanel() {
  const { data } = useUpdates()
  const upload = useUploadUpdate()
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'waiting' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // Poll until the server comes back on the target version (it restarts mid-poll).
  const waitForVersion = (target: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const info = await api.get<UpdatesInfo>('/api/admin/updates')
        if (info.current === target) {
          if (pollRef.current) clearInterval(pollRef.current)
          setPhase('done')
          setMsg(`Update complete — now running v${target}.`)
          qc.invalidateQueries({ queryKey: ['updates'] })
          qc.invalidateQueries({ queryKey: ['system'] })
        }
      } catch {
        /* server is restarting — keep polling */
      }
    }, 2000)
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhase('uploading')
    setMsg('Uploading and applying package…')
    try {
      const res = await upload.mutateAsync(file)
      if (res.restarting) {
        setPhase('waiting')
        setMsg(`Applied v${res.version} — the server is restarting…`)
        waitForVersion(res.version)
      } else {
        setPhase('done')
        setMsg(`Applied v${res.version}. Restart the server to finish (no supervisor detected).`)
      }
    } catch (err) {
      setPhase('error')
      setMsg(err instanceof ApiError ? err.message : 'Update failed')
    }
  }

  const busy = phase === 'uploading' || phase === 'waiting'

  return (
    <div className="mt-6">
      <h2 className="fw-mono-label">Software updates</h2>
      <div className="fw-card mt-2 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">
            Current version <span className="font-semibold text-ink">v{data?.current ?? '…'}</span>
          </span>
          <button onClick={() => inputRef.current?.click()} disabled={busy} className="fw-btn-ghost h-9 px-3.5 text-sm">
            <UploadIcon className="h-4 w-4" />
            {busy ? 'Working…' : 'Upload update package (.zip)'}
          </button>
          <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onFile} />
        </div>

        {data && !data.supervised && (
          <p className="mt-2 text-xs text-amber-400">
            No supervisor detected — after applying, you must restart the server yourself. Run the app with{' '}
            <code className="font-mono">pnpm start</code> (the supervisor) for automatic restarts.
          </p>
        )}
        {msg && <p className={`mt-2 text-sm ${phase === 'error' ? 'text-red-400' : 'text-muted'}`}>{msg}</p>}
        <p className="mt-2 text-xs text-muted">
          Updates replace application code only. Your configuration, database, and media are never touched, and a failed
          update rolls back automatically.
        </p>

        {data && data.history.length > 0 && (
          <div className="mt-4">
            <h3 className="fw-mono-label">History</h3>
            <div className="fw-card mt-2 divide-y divide-line">
              {data.history.map((h, i) => (
                <details key={`${h.version}-${h.appliedAt}-${i}`} className="px-3 py-2">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                    <span className="text-ink">v{h.version}</span>
                    <span className="flex items-center gap-2 text-muted">
                      <span className="text-xs">{fmtDate(h.appliedAt)}</span>
                      <span className={`rounded-theme-sm bg-surface-2 px-2 py-0.5 text-xs ${STATUS_CLASS[h.status]}`}>
                        {STATUS_LABEL[h.status]}
                      </span>
                    </span>
                  </summary>
                  {h.changelog && <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-muted">{h.changelog}</pre>}
                  {h.note && <p className="mt-1 text-xs text-red-400">{h.note}</p>}
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
