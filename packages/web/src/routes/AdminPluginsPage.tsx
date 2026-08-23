import { useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  PLUGIN_PERMISSION_LABELS,
  type AdminPluginDto,
  type PluginField,
  type PluginPermission,
} from '@free-wan/shared'
import { PageShell } from '../components/AppLayout'
import { AdminTabs } from '../components/AdminTabs'
import { UploadIcon } from '../components/icons'
import { useMe } from '../lib/auth'
import { ApiError } from '../lib/api'
import {
  useAdminPlugins,
  useInstallPlugin,
  useUploadPlugin,
  useUpdatePlugin,
  useUninstallPlugin,
  usePluginRuns,
} from '../lib/plugins'

function errMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong'
}

const STATUS_TONE: Record<string, string> = {
  active: 'text-accent',
  error: 'text-red-400',
  disabled: 'text-muted',
  installed: 'text-muted',
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!on)} disabled={disabled} className="flex items-center gap-2.5 text-sm text-ink disabled:opacity-50">
      <span className="relative inline-block h-5 w-[34px] flex-none rounded-full transition-colors" style={{ background: on ? 'var(--fw-primary)' : 'var(--fw-surface-2)' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? '16px' : '2px' }} />
      </span>
      {label}
    </button>
  )
}

function InstallBar() {
  const install = useInstallPlugin()
  const upload = useUploadPlugin()
  const fileRef = useRef<HTMLInputElement>(null)
  const [path, setPath] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      setPath('')
      setUrl('')
    } catch (e) {
      setError(errMessage(e))
    }
  }

  return (
    <div className="fw-card mt-4 flex flex-col gap-4 p-5">
      <div className="font-head text-[15px] font-semibold text-ink">Install a plugin</div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <span className="fw-mono-label">From a server path</span>
          <div className="flex gap-2">
            <input value={path} onChange={(e) => setPath(e.target.value)} className="fw-input font-mono text-[12px]" placeholder="/path/to/plugin-dir or .zip" />
            <button onClick={() => run(() => install.mutateAsync({ source: 'path', path: path.trim() }))} disabled={!path.trim() || install.isPending} className="fw-btn-ghost h-11 flex-none px-3.5 text-[13px]">
              Install
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="fw-mono-label">From a URL (.zip)</span>
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className="fw-input font-mono text-[12px]" placeholder="https://…/plugin.zip" />
            <button onClick={() => run(() => install.mutateAsync({ source: 'url', url: url.trim() }))} disabled={!url.trim() || install.isPending} className="fw-btn-ghost h-11 flex-none px-3.5 text-[13px]">
              Install
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="fw-mono-label">Upload a .zip</span>
          <button onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="fw-btn-ghost h-11 px-3.5 text-[13px]">
            <UploadIcon className="h-4 w-4" /> {upload.isPending ? 'Uploading…' : 'Choose file'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void run(() => upload.mutateAsync(f))
              e.target.value = ''
            }}
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}

function ConfigField({ field, value, onChange }: { field: PluginField; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === 'boolean') {
    return <Toggle on={Boolean(value)} onChange={onChange} label={field.label} />
  }
  return (
    <label className="flex min-w-[200px] flex-1 flex-col gap-2">
      <span className="fw-mono-label">{field.label}</span>
      {field.type === 'enum' ? (
        <select value={String(value ?? field.default ?? '')} onChange={(e) => onChange(e.target.value)} className="fw-input">
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input type={field.type === 'number' ? 'number' : 'text'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="fw-input" />
      )}
      {field.help && <span className="text-[11px] text-muted">{field.help}</span>}
    </label>
  )
}

function PermissionList({ permissions }: { permissions: PluginPermission[] }) {
  if (permissions.length === 0) return <span className="text-[12px] text-muted">No special permissions.</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {permissions.map((p) => (
        <span key={p} className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted" title={p}>
          {PLUGIN_PERMISSION_LABELS[p] ?? p}
        </span>
      ))}
    </div>
  )
}

function Activity({ pluginId }: { pluginId: string }) {
  const { data } = usePluginRuns(pluginId)
  const runs = data?.data ?? []
  if (runs.length === 0) return <p className="text-[12px] text-muted">No activity yet.</p>
  return (
    <div className="flex flex-col gap-1.5">
      {runs.slice(0, 12).map((r) => (
        <div key={r.id} className="flex items-center gap-2 font-mono text-[11px]">
          <span className={STATUS_TONE[r.status === 'succeeded' ? 'active' : r.status] ?? 'text-muted'}>{r.status}</span>
          <span className="text-muted">{r.kind}</span>
          {r.ref && <span className="text-ink">{r.ref}</span>}
          {r.error && <span className="truncate text-red-400">· {r.error}</span>}
        </div>
      ))}
    </div>
  )
}

function PluginCard({ p }: { p: AdminPluginDto }) {
  const update = useUpdatePlugin()
  const uninstall = useUninstallPlugin()
  const [open, setOpen] = useState<'config' | 'activity' | null>(null)
  const [config, setConfig] = useState<Record<string, unknown>>(p.config)
  const [error, setError] = useState<string | null>(null)

  const toggleEnabled = async (enabled: boolean) => {
    setError(null)
    try {
      await update.mutateAsync({ id: p.id, body: { enabled } })
    } catch (e) {
      setError(errMessage(e))
    }
  }
  const saveConfig = async () => {
    setError(null)
    try {
      await update.mutateAsync({ id: p.id, body: { config } })
    } catch (e) {
      setError(errMessage(e))
    }
  }
  const onUninstall = () => {
    if (window.confirm(`Uninstall "${p.name}"? This stops it and removes its files and history.`)) uninstall.mutate(p.id)
  }

  return (
    <div className="fw-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-head text-[16px] font-semibold text-ink">{p.name}</span>
            <span className="font-mono text-[11px] text-muted">v{p.version}</span>
            <span className={`font-mono text-[10.5px] uppercase ${STATUS_TONE[p.status] ?? 'text-muted'}`}>{p.status}</span>
            {p.daemon && <span className="rounded bg-surface-2 px-1.5 py-px font-mono text-[9px] uppercase text-muted">daemon</span>}
          </div>
          {p.description && <div className="mt-1 max-w-2xl text-[12.5px] text-muted">{p.description}</div>}
          <div className="mt-1 font-mono text-[10.5px] text-muted">
            {p.id}
            {p.author ? ` · ${p.author}` : ''}
            {p.events.length ? ` · reacts to ${p.events.join(', ')}` : ''}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <Toggle on={p.enabled} onChange={toggleEnabled} label={p.enabled ? 'Enabled' : 'Disabled'} disabled={update.isPending} />
        </div>
      </div>

      {p.status === 'error' && p.lastError && (
        <div className="mt-3 rounded-theme-sm border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-[12px] text-red-300">{p.lastError}</div>
      )}

      <div className="mt-3.5">
        <span className="fw-mono-label">Permissions</span>
        <div className="mt-1.5">
          <PermissionList permissions={p.permissions} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5 text-[13px]">
        {p.manifest.config.length > 0 && (
          <button onClick={() => setOpen(open === 'config' ? null : 'config')} className="fw-btn-ghost h-9 px-3.5">
            Configure
          </button>
        )}
        <button onClick={() => setOpen(open === 'activity' ? null : 'activity')} className="fw-btn-ghost h-9 px-3.5">
          Activity
        </button>
        <button onClick={onUninstall} disabled={uninstall.isPending} className="fw-btn-ghost h-9 px-3.5 hover:border-red-500 hover:text-red-400">
          Uninstall
        </button>
      </div>

      {open === 'config' && (
        <div className="mt-4 flex flex-col gap-3 rounded-theme-sm border border-line bg-bg p-4">
          <div className="flex flex-wrap gap-3.5">
            {p.manifest.config.map((f) => (
              <ConfigField key={f.name} field={f} value={config[f.name]} onChange={(v) => setConfig((c) => ({ ...c, [f.name]: v }))} />
            ))}
          </div>
          <div>
            <button onClick={saveConfig} disabled={update.isPending} className="fw-btn-primary h-9 px-4 text-[13px]">
              {update.isPending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}

      {open === 'activity' && (
        <div className="mt-4 rounded-theme-sm border border-line bg-bg p-4">
          <Activity pluginId={p.id} />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  )
}

export function AdminPluginsPage() {
  const { data: me, isLoading: meLoading } = useMe()
  const { data, isLoading } = useAdminPlugins()

  if (!meLoading && me && me.role !== 'admin') return <Navigate to="/" replace />

  const plugins = data?.data ?? []
  const disabled = data && !data.enabled

  return (
    <PageShell home trail={[{ label: 'Admin' }, { label: 'Plugins' }]}>
      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-6">
        <h1 className="font-head text-2xl font-semibold tracking-[-0.01em] text-ink">Plugins</h1>
        <AdminTabs />
        <p className="mt-4 text-sm text-muted">
          Plugins are sandboxed server extensions that can read the library, contribute interactive panels, run on
          command, and react to events. Install only plugins you trust — see <code className="font-mono">docs/13-plugins.md</code>.
        </p>

        {disabled ? (
          <div className="mt-5 rounded-theme-sm border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] text-amber-300">
            The plugin subsystem is disabled on this server (<code className="font-mono">PLUGINS_ENABLED=false</code>).
          </div>
        ) : (
          <>
            <InstallBar />
            {data?.registryUrl && (
              <p className="mt-3 text-[12.5px] text-muted">
                Browse the catalog:{' '}
                <a href={data.registryUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {data.registryUrl}
                </a>
              </p>
            )}
            <div className="mt-6 flex flex-col gap-4">
              <h2 className="fw-mono-label">Installed</h2>
              {isLoading ? (
                <p className="text-sm text-muted">Loading…</p>
              ) : plugins.length === 0 ? (
                <p className="text-sm text-muted">No plugins installed yet.</p>
              ) : (
                plugins.map((p) => <PluginCard key={p.id} p={p} />)
              )}
            </div>
          </>
        )}
      </main>
    </PageShell>
  )
}
