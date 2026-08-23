import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { CommandDto, CommandParamDto } from '@free-wan/shared'
import { PageShell } from '../components/AppLayout'
import { TerminalIcon, PlayIcon, CheckIcon } from '../components/icons'
import { useMe } from '../lib/auth'
import { useCommands, useRunCommand, useRun, cancelRun } from '../lib/commands'
import { subscribeTopic } from '../lib/ws'

function Tag({ internal }: { internal: boolean }) {
  return (
    <span
      className={`rounded font-mono text-[9px] uppercase tracking-[0.06em] ${
        internal ? 'border border-line px-1.5 py-px text-muted' : 'border border-accent px-1.5 py-px text-accent'
      }`}
    >
      {internal ? 'Internal' : 'External'}
    </span>
  )
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className="relative inline-block h-5 w-[34px] flex-none rounded-full transition-colors"
      style={{ background: on ? 'var(--fw-primary)' : 'var(--fw-surface-2)' }}
    >
      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? '16px' : '2px' }} />
    </button>
  )
}

function Field({ p, value, onChange }: { p: CommandParamDto; value: unknown; onChange: (v: unknown) => void }) {
  if (p.type === 'boolean') {
    return (
      <div className="flex w-full items-center gap-2.5">
        <Switch on={Boolean(value)} onClick={() => onChange(!value)} />
        <span className="text-sm text-ink">{p.label}</span>
      </div>
    )
  }
  const label = (
    <span className="fw-mono-label">
      {p.label}
      {p.required && <span className="text-primary"> *</span>}
    </span>
  )
  return (
    <label className="flex min-w-[240px] flex-1 flex-col gap-2">
      {label}
      {p.type === 'enum' ? (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="fw-input">
          {(p.constraints?.options ?? []).map((o) => (
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
          placeholder={p.type === 'repo_path' ? 'path within the repository' : undefined}
          className="fw-input"
        />
      )}
    </label>
  )
}

function elapsed(startedAt: number | null, finishedAt: number | null): string {
  if (!startedAt) return '00:00'
  const ms = (finishedAt ?? Date.now()) - startedAt
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const STATUS_PILL: Record<string, string> = {
  succeeded: 'text-accent',
  failed: 'text-red-400',
  timeout: 'text-red-400',
  canceled: 'text-muted',
}

function Runner({ command }: { command: CommandDto }) {
  const run = useRunCommand()
  const qc = useQueryClient()
  const [args, setArgs] = useState<Record<string, unknown>>({})
  const [runId, setRunId] = useState<string | null>(null)
  const [wsOutput, setWsOutput] = useState('')
  const { data: runState } = useRun(runId)
  const live = runState?.status === 'queued' || runState?.status === 'running'

  // Live output streams over the WebSocket as the process writes it; the poll (useRun)
  // stays as the fallback and delivers the final persisted row.
  useEffect(() => {
    if (!runId) return
    setWsOutput('')
    return subscribeTopic(`run:${runId}`, (raw) => {
      const ev = raw as { type?: string; runId?: string; chunk?: string; status?: string }
      if (ev.runId !== runId) return
      if (ev.type === 'run.output' && ev.chunk) setWsOutput((s) => s + ev.chunk)
      if (ev.type === 'run.status' && ev.status && ev.status !== 'running') {
        void qc.invalidateQueries({ queryKey: ['run', runId] }) // fetch the persisted result now
      }
    })
  }, [runId, qc])

  const valid = useMemo(
    () => command.params.every((p) => !p.required || p.type === 'boolean' || String(args[p.name] ?? '').trim() !== ''),
    [command.params, args],
  )

  const submit = async () => {
    const r = await run.mutateAsync({ id: command.id, args })
    setRunId(r.runId)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/* form card */}
      <div className="fw-card flex flex-col gap-[18px] p-[22px]">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <div className="font-head text-[19px] font-semibold text-ink">{command.name}</div>
              <Tag internal={command.isInternal} />
            </div>
            {command.description && <div className="mt-1.5 text-[13px] text-muted">{command.description}</div>}
          </div>
          <button onClick={submit} disabled={run.isPending || live} className="fw-btn-primary h-10 px-5 text-[14px]">
            <PlayIcon className="h-4 w-4" /> {live ? 'Running…' : 'Run'}
          </button>
        </div>

        {command.params.length > 0 && (
          <>
            <div className="h-px bg-line" />
            <div className="flex flex-wrap gap-[18px]">
              {command.params.map((p) => (
                <Field key={p.id} p={p} value={args[p.name]} onChange={(v) => setArgs((a) => ({ ...a, [p.name]: v }))} />
              ))}
            </div>
            <div className={`flex items-center gap-2 text-[12px] ${valid ? 'text-accent' : 'text-muted'}`}>
              {valid && (
                <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full text-bg" style={{ background: 'var(--fw-accent)' }}>
                  <CheckIcon className="h-2.5 w-2.5" />
                </span>
              )}
              {valid ? 'All fields valid' : 'Fill the required fields to run.'}
            </div>
          </>
        )}
      </div>

      {/* live output */}
      {(runState || live) && (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="font-head text-[14px] font-semibold text-ink">Live output</div>
            {live ? (
              <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] text-accent" style={{ background: 'var(--fw-accent-tint)' }}>
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--fw-accent)', animation: 'fwpulse 1.2s ease-in-out infinite' }} />
                RUNNING
              </span>
            ) : (
              runState && (
                <span className={`font-mono text-[11px] uppercase ${STATUS_PILL[runState.status] ?? 'text-muted'}`}>
                  {runState.status}
                  {runState.exitCode !== null && ` · exit ${runState.exitCode}`}
                </span>
              )
            )}
            {runState?.truncated && <span className="font-mono text-[11px] text-amber-400">· truncated</span>}
            <div className="flex-1" />
            {runState?.startedAt && (
              <span className="font-mono text-[11px] text-muted">elapsed {elapsed(runState.startedAt, runState.finishedAt)}</span>
            )}
            {runId && live && (
              <button onClick={() => cancelRun(runId)} className="fw-btn-ghost h-[30px] px-3.5 text-[12px]">
                Cancel
              </button>
            )}
          </div>
          <pre className="min-h-[200px] flex-1 overflow-auto rounded-theme-sm border border-line p-4 font-mono text-[12px] leading-relaxed text-[#c8c8d6]" style={{ background: '#0a0a0f' }}>
            {runState?.resolvedArgv?.length ? <span className="text-[#6c6c80]">{`$ ${runState.resolvedArgv.join(' ')}\n`}</span> : null}
            {live ? wsOutput || (runState?.output ?? '') : (runState?.output ?? '')}
          </pre>
        </div>
      )}
    </div>
  )
}

function CommandRow({ c, active, onClick }: { c: CommandDto; active: boolean; onClick: () => void }) {
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
        <TerminalIcon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-ink">{c.name}</span>
          <Tag internal={c.isInternal} />
        </div>
        {c.description && <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">{c.description}</div>}
      </div>
    </button>
  )
}

export function CommandsPage() {
  const { data, isLoading } = useCommands()
  const { data: me } = useMe()
  const [selected, setSelected] = useState<string | null>(null)
  const commands = data?.data ?? []
  const current = commands.find((c) => c.id === selected) ?? commands[0]

  return (
    <PageShell home trail={[{ label: 'Commands' }]}>
      {isLoading ? (
        <p className="p-[22px] text-muted">Loading…</p>
      ) : commands.length === 0 ? (
        <div className="p-[22px] text-muted">
          <p>No commands available to you.</p>
          {me?.role === 'admin' && (
            <Link to="/settings/commands" className="mt-2 inline-block text-primary hover:underline">
              Define one in Admin → Commands
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-[22px] p-4 sm:p-[22px] lg:flex-row">
          <div className="flex w-full flex-none flex-col gap-3 lg:w-[344px]">
            <div className="font-head text-[18px] font-semibold text-ink">Commands</div>
            {commands.map((c) => (
              <CommandRow key={c.id} c={c} active={current?.id === c.id} onClick={() => setSelected(c.id)} />
            ))}
          </div>
          {current && <Runner key={current.id} command={current} />}
        </div>
      )}
    </PageShell>
  )
}
