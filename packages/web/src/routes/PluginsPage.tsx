import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PluginCommandDef, PluginDto, PluginField, PluginPanelDef } from '@free-wan/shared'
import { PageShell } from '../components/AppLayout'
import { PluginView } from '../components/PluginView'
import { PluginIcon, PlayIcon } from '../components/icons'
import { useMe } from '../lib/auth'
import { usePlugins, usePanel, usePanelAction, useRunPluginCommand, usePluginRun } from '../lib/plugins'

/** Inline plugin glyph: the sanitized manifest SVG if present, else the default puzzle icon. */
function Glyph({ icon, className }: { icon: string | null; className?: string }) {
  if (icon) return <span className={className} dangerouslySetInnerHTML={{ __html: icon }} />
  return <PluginIcon className={className} />
}

function Field({ p, value, onChange }: { p: PluginField; value: unknown; onChange: (v: unknown) => void }) {
  if (p.type === 'boolean') {
    return (
      <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-2.5 text-sm text-ink">
        <span className="relative inline-block h-5 w-[34px] flex-none rounded-full transition-colors" style={{ background: value ? 'var(--fw-primary)' : 'var(--fw-surface-2)' }}>
          <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: value ? '16px' : '2px' }} />
        </span>
        {p.label}
      </button>
    )
  }
  return (
    <label className="flex min-w-[220px] flex-1 flex-col gap-2">
      <span className="fw-mono-label">
        {p.label}
        {p.required && <span className="text-primary"> *</span>}
      </span>
      {p.type === 'enum' ? (
        <select value={String(value ?? p.default ?? '')} onChange={(e) => onChange(e.target.value)} className="fw-input">
          {(p.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={p.type === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="fw-input"
        />
      )}
    </label>
  )
}

const RUN_PILL: Record<string, string> = { succeeded: 'text-accent', failed: 'text-red-400', timeout: 'text-red-400' }

function CommandRunner({ pluginId, command }: { pluginId: string; command: PluginCommandDef }) {
  const run = useRunPluginCommand(pluginId)
  const [args, setArgs] = useState<Record<string, unknown>>({})
  const [runId, setRunId] = useState<string | null>(null)
  const { data: state } = usePluginRun(pluginId, runId)
  const live = state?.status === 'queued' || state?.status === 'running'

  const valid = useMemo(
    () => (command.params ?? []).every((p) => !p.required || p.type === 'boolean' || String(args[p.name] ?? p.default ?? '').trim() !== ''),
    [command.params, args],
  )

  const submit = async () => {
    const r = await run.mutateAsync({ command: command.id, args })
    setRunId(r.runId)
  }

  return (
    <div className="fw-card flex flex-col gap-3.5 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-head text-[15px] font-semibold text-ink">{command.name}</div>
          {command.description && <div className="mt-0.5 text-[12.5px] text-muted">{command.description}</div>}
        </div>
        <button onClick={submit} disabled={run.isPending || live || !valid} className="fw-btn-primary h-9 px-4 text-[13px]">
          <PlayIcon className="h-3.5 w-3.5" /> {live ? 'Running…' : 'Run'}
        </button>
      </div>
      {(command.params ?? []).length > 0 && (
        <div className="flex flex-wrap gap-3.5">
          {(command.params ?? []).map((p) => (
            <Field key={p.name} p={p} value={args[p.name]} onChange={(v) => setArgs((a) => ({ ...a, [p.name]: v }))} />
          ))}
        </div>
      )}
      {state && (
        <div className="flex flex-col gap-1.5">
          <span className={`font-mono text-[11px] uppercase ${RUN_PILL[state.status] ?? 'text-muted'}`}>{state.status}</span>
          {(state.output || state.error) && (
            <pre className="max-h-[220px] overflow-auto rounded-theme-sm border border-line p-3 font-mono text-[12px] leading-relaxed text-[#c8c8d6]" style={{ background: '#0a0a0f' }}>
              {state.output ?? state.error}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/** A panel is a plain surface the plugin composes (its blocks bring their own cards). */
function Panel({ pluginId, panel }: { pluginId: string; panel: PluginPanelDef }) {
  // Pause the live poll while the user is interacting with the form (focus is inside the panel),
  // so a refetch can't re-render mid-selection and close a native dropdown or fight typing.
  const [interacting, setInteracting] = useState(false)
  const { data, isLoading, error } = usePanel(pluginId, panel.id, true, panel.refreshMs, interacting)
  const action = usePanelAction(pluginId, panel.id)

  if (isLoading) return <div className="fw-card p-6 text-[13px] text-muted">Loading {panel.title}…</div>
  if (error || !data) {
    return (
      <div className="fw-card p-6 text-[13px] text-red-400" style={{ borderColor: 'color-mix(in srgb, #f87171 35%, transparent)' }}>
        “{panel.title}” failed to load. The plugin may have errored — check Admin → Plugins → Activity.
      </div>
    )
  }
  return (
    <div
      className="relative flex flex-col gap-4"
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(e) => {
        // Focus left the panel entirely (not just moved between fields) → resume live polling.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInteracting(false)
      }}
    >
      {action.isPending && (
        <span className="pointer-events-none absolute -top-1 right-0 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-accent" style={{ background: 'var(--fw-accent-tint)' }}>
          <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--fw-accent)', animation: 'fwpulse 1.2s ease-in-out infinite' }} />
          working
        </span>
      )}
      <PluginView view={data.view} busy={action.isPending} onAction={(payload) => action.mutate(payload)} />
    </div>
  )
}

function PluginRow({ p, active, onClick }: { p: PluginDto; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={active ? { boxShadow: 'inset 0 0 0 1px var(--fw-primary)' } : undefined}
      className={`flex gap-3 rounded-theme-sm border bg-surface p-3.5 text-left transition ${active ? 'border-primary' : 'border-line hover:border-muted'}`}
    >
      <div
        className={`flex h-[38px] w-[38px] flex-none items-center justify-center rounded-theme-sm ${active ? 'text-primary' : 'text-ink'}`}
        style={{ background: active ? 'var(--fw-primary-tint)' : 'var(--fw-surface-2)' }}
      >
        <Glyph icon={p.icon} className="flex h-[18px] w-[18px] items-center justify-center [&>svg]:h-full [&>svg]:w-full" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-ink">{p.name}</span>
          {p.daemon && <span className="rounded bg-surface-2 px-1.5 py-px font-mono text-[9px] uppercase text-muted">daemon</span>}
        </div>
        {p.description && <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">{p.description}</div>}
      </div>
    </button>
  )
}

export function PluginsPage() {
  const { data, isLoading } = usePlugins()
  const { data: me } = useMe()
  const [selected, setSelected] = useState<string | null>(null)
  const pluginList = data?.data ?? []
  const current = pluginList.find((p) => p.id === selected) ?? pluginList[0]

  return (
    <PageShell home trail={[{ label: 'Plugins' }]}>
      {isLoading ? (
        <p className="p-[22px] text-muted">Loading…</p>
      ) : pluginList.length === 0 ? (
        <div className="p-[22px] text-muted">
          <p>No plugins available to you.</p>
          {me?.role === 'admin' && (
            <Link to="/settings/plugins" className="mt-2 inline-block text-primary hover:underline">
              Install one in Admin → Plugins
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-[22px] p-4 sm:p-[22px] lg:flex-row">
          <div className="flex w-full flex-none flex-col gap-3 lg:w-[320px]">
            <div className="font-head text-[18px] font-semibold text-ink">Plugins</div>
            {pluginList.map((p) => (
              <PluginRow key={p.id} p={p} active={current?.id === p.id} onClick={() => setSelected(p.id)} />
            ))}
          </div>
          {current && (
            <div className="flex min-w-0 flex-1 flex-col gap-5 lg:max-w-3xl">
              {current.panels.length === 0 && current.commands.length === 0 && (
                <p className="text-[13px] text-muted">This plugin exposes no panels or commands.</p>
              )}
              {current.panels.map((panel) => (
                <Panel key={panel.id} pluginId={current.id} panel={panel} />
              ))}
              {current.commands.length > 0 && (
                <>
                  <div className="font-head text-[14px] font-semibold text-ink">Actions</div>
                  {current.commands.map((c) => (
                    <CommandRunner key={c.id} pluginId={current.id} command={c} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </PageShell>
  )
}
