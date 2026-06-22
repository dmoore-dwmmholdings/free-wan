import { useState } from 'react'
import type { CommandDto, CommandParamDto } from '@free-wan/shared'
import { AppHeader } from '../components/AppHeader'
import { useCommands, useRunCommand, useRun, cancelRun } from '../lib/commands'

function Field({ p, value, onChange }: { p: CommandParamDto; value: unknown; onChange: (v: unknown) => void }) {
  const label = (
    <span className="mb-1 block text-sm text-neutral-300">
      {p.label}
      {p.required && <span className="text-red-400"> *</span>}
    </span>
  )
  const cls = 'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-brand'
  if (p.type === 'boolean') {
    return (
      <label className="mb-3 flex items-center gap-2 text-sm text-neutral-300">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {p.label}
      </label>
    )
  }
  if (p.type === 'enum') {
    return (
      <label className="mb-3 block">
        {label}
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={cls}>
          {(p.constraints?.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    )
  }
  return (
    <label className="mb-3 block">
      {label}
      <input
        type={p.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={p.type === 'repo_path' ? 'path within the repository' : undefined}
        className={cls}
      />
    </label>
  )
}

function Runner({ command }: { command: CommandDto }) {
  const run = useRunCommand()
  const [args, setArgs] = useState<Record<string, unknown>>({})
  const [runId, setRunId] = useState<string | null>(null)
  const { data: runState } = useRun(runId)
  const live = runState?.status === 'queued' || runState?.status === 'running'

  const submit = async () => {
    const r = await run.mutateAsync({ id: command.id, args })
    setRunId(r.runId)
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">{command.name}</h2>
      {command.description && <p className="text-sm text-neutral-500">{command.description}</p>}
      <div className="mt-4 max-w-md">
        {command.params.map((p) => (
          <Field key={p.id} p={p} value={args[p.name]} onChange={(v) => setArgs((a) => ({ ...a, [p.name]: v }))} />
        ))}
        <button
          onClick={submit}
          disabled={run.isPending || live}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {live ? 'Running…' : 'Run'}
        </button>
        {runId && live && (
          <button onClick={() => cancelRun(runId)} className="ml-3 rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-red-500 hover:text-red-400">
            Cancel
          </button>
        )}
      </div>

      {runState && (
        <div className="mt-4">
          <div className="text-sm text-neutral-400">
            Status: <span className="text-neutral-200">{runState.status}</span>
            {runState.exitCode !== null && <> · exit {runState.exitCode}</>}
            {runState.truncated && <span className="text-amber-400"> · output truncated</span>}
          </div>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-black p-3 text-xs text-neutral-200">
            {runState.output ?? ''}
          </pre>
        </div>
      )}
    </div>
  )
}

export function CommandsPage() {
  const { data, isLoading } = useCommands()
  const [selected, setSelected] = useState<string | null>(null)
  const commands = data?.data ?? []
  const current = commands.find((c) => c.id === selected) ?? commands[0]

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="px-6 py-6">
        <h1 className="text-2xl font-semibold">Commands</h1>
        {isLoading ? (
          <p className="mt-4 text-neutral-500">Loading…</p>
        ) : commands.length === 0 ? (
          <p className="mt-4 text-neutral-500">No commands available to you. An admin can register them via the API.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
            <nav className="flex flex-col gap-1">
              {commands.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className={`rounded-lg px-3 py-2 text-left text-sm ${current?.id === c.id ? 'bg-neutral-800 text-brand' : 'text-neutral-300 hover:bg-neutral-900'}`}
                >
                  {c.name}
                </button>
              ))}
            </nav>
            {current && <Runner key={current.id} command={current} />}
          </div>
        )}
      </main>
    </div>
  )
}
