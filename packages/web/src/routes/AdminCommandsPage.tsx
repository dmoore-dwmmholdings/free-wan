import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { AdminCommandDto, CommandParamType, CreateCommandRequest } from '@free-wan/shared'
import { PageShell } from '../components/AppLayout'
import { AdminTabs } from '../components/AdminTabs'
import { PlusIcon, CloseIcon } from '../components/icons'
import { useMe } from '../lib/auth'
import { ApiError } from '../lib/api'
import { useAdminCommands, useCreateCommand, useUpdateCommand, useDeleteCommand } from '../lib/commands'

const PARAM_TYPES: CommandParamType[] = ['string', 'number', 'boolean', 'enum', 'repo_path']

function errMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong'
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2.5 text-sm text-ink">
      <span className="relative inline-block h-5 w-[34px] flex-none rounded-full transition-colors" style={{ background: on ? 'var(--fw-primary)' : 'var(--fw-surface-2)' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? '16px' : '2px' }} />
      </span>
      {label}
    </button>
  )
}

interface ParamDraft {
  name: string
  label: string
  type: CommandParamType
  required: boolean
  default: string
  options: string
}

const ARG_TEMPLATE_EXAMPLE = '[\n  "--input",\n  { "param": "file" },\n  { "param": "verbose", "whenTrue": ["-v"] }\n]'

function emptyParam(): ParamDraft {
  return { name: '', label: '', type: 'string', required: false, default: '', options: '' }
}

/** Create/edit modal. `initial` undefined = new command. */
function CommandEditor({
  initial,
  executables,
  onClose,
}: {
  initial?: AdminCommandDto
  executables: string[]
  onClose: () => void
}) {
  const create = useCreateCommand()
  const update = useUpdateCommand()
  const editing = !!initial

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [executable, setExecutable] = useState(initial?.executable ?? executables[0] ?? '')
  const [argTemplateText, setArgTemplateText] = useState(
    initial ? JSON.stringify(initial.argTemplate, null, 2) : '[]',
  )
  const [workingDir, setWorkingDir] = useState(initial?.workingDir ?? '')
  const [timeoutS, setTimeoutS] = useState(String(initial?.timeoutS ?? 600))
  const [maxOutputKb, setMaxOutputKb] = useState(String(initial?.maxOutputKb ?? 1024))
  const [maxConcurrent, setMaxConcurrent] = useState(String(initial?.maxConcurrent ?? 1))
  const [envAllowlistText, setEnvAllowlistText] = useState((initial?.envAllowlist ?? []).join(', '))
  const [allowNonAdmin, setAllowNonAdmin] = useState(initial?.allowNonAdmin ?? false)
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [params, setParams] = useState<ParamDraft[]>(
    initial?.params.map((p) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      required: !!p.required,
      default: p.default ?? '',
      options: (p.constraints?.options ?? []).join(', '),
    })) ?? [],
  )
  const [localError, setLocalError] = useState<string | null>(null)

  const setParam = (i: number, patch: Partial<ParamDraft>) =>
    setParams((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  const pending = create.isPending || update.isPending
  const noExecutables = executables.length === 0

  const submit = async () => {
    setLocalError(null)
    if (!name.trim()) return setLocalError('Give the command a name.')
    if (!executable) return setLocalError('Pick an executable.')
    let argTemplate: unknown
    try {
      argTemplate = JSON.parse(argTemplateText || '[]')
    } catch {
      return setLocalError('Argument template is not valid JSON.')
    }
    if (!Array.isArray(argTemplate)) return setLocalError('Argument template must be a JSON array.')

    const body: CreateCommandRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      executable,
      argTemplate: argTemplate as CreateCommandRequest['argTemplate'],
      workingDir: workingDir.trim() || null,
      timeoutS: Number(timeoutS) || 600,
      maxOutputKb: Number(maxOutputKb) || 1024,
      maxConcurrent: Math.max(1, Number(maxConcurrent) || 1),
      envAllowlist: envAllowlistText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
      allowNonAdmin,
      enabled,
      params: params.map((p) => ({
        name: p.name.trim(),
        label: p.label.trim() || p.name.trim(),
        type: p.type,
        required: p.required,
        default: p.default.trim() || null,
        constraints: p.type === 'enum' ? { options: p.options.split(',').map((s) => s.trim()).filter(Boolean) } : undefined,
      })),
    }

    try {
      if (editing) await update.mutateAsync({ id: initial.id, body })
      else await create.mutateAsync(body)
      onClose()
    } catch (e) {
      setLocalError(errMessage(e))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="fw-card w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-head text-xl font-semibold text-ink">{editing ? 'Edit command' : 'New command'}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {noExecutables && (
          <p className="mt-4 rounded-theme-sm border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] text-amber-300">
            No executables are allowlisted. Set <code className="font-mono">COMMAND_ALLOWED_EXECUTABLES</code> (a comma-separated
            list of program names or absolute paths) in the server environment and restart, then a command can be saved.
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="fw-input" placeholder="Re-encode folder" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Executable</span>
            <select value={executable} onChange={(e) => setExecutable(e.target.value)} className="fw-input font-mono" disabled={noExecutables}>
              {noExecutables && <option value="">— none allowlisted —</option>}
              {executables.map((ex) => (
                <option key={ex} value={ex}>
                  {ex}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 sm:col-span-2">
            <span className="fw-mono-label">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="fw-input" placeholder="What this command does" />
          </label>
        </div>

        <label className="mt-4 flex flex-col gap-2">
          <span className="fw-mono-label">Argument template (JSON)</span>
          <textarea
            value={argTemplateText}
            onChange={(e) => setArgTemplateText(e.target.value)}
            spellCheck={false}
            rows={5}
            className="fw-input font-mono text-[12px]"
            placeholder={ARG_TEMPLATE_EXAMPLE}
          />
          <span className="text-[11px] text-muted">
            An array of literal strings and parameter tokens like <code className="font-mono">{'{ "param": "file" }'}</code> or{' '}
            <code className="font-mono">{'{ "param": "verbose", "whenTrue": ["-v"] }'}</code>.
          </span>
        </label>

        {/* Parameters */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <span className="fw-mono-label">Parameters</span>
            <button onClick={() => setParams((ps) => [...ps, emptyParam()])} className="fw-btn-ghost h-8 px-3 text-[12.5px]">
              <PlusIcon className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          {params.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted">No parameters — the command runs with a fixed argument template.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-3">
              {params.map((p, i) => (
                <div key={i} className="rounded-theme-sm border border-line bg-bg p-3">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <input value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} className="fw-input" placeholder="name" />
                    <input value={p.label} onChange={(e) => setParam(i, { label: e.target.value })} className="fw-input" placeholder="Label" />
                    <select value={p.type} onChange={(e) => setParam(i, { type: e.target.value as CommandParamType })} className="fw-input">
                      {PARAM_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input value={p.default} onChange={(e) => setParam(i, { default: e.target.value })} className="fw-input" placeholder="default" />
                  </div>
                  {p.type === 'enum' && (
                    <input value={p.options} onChange={(e) => setParam(i, { options: e.target.value })} className="fw-input mt-2.5" placeholder="comma,separated,options" />
                  )}
                  <div className="mt-2.5 flex items-center justify-between">
                    <Toggle on={p.required} onChange={(v) => setParam(i, { required: v })} label="Required" />
                    <button onClick={() => setParams((ps) => ps.filter((_, j) => j !== i))} className="text-[12px] text-muted hover:text-red-400">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Advanced */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Working directory</span>
            <input value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} className="fw-input font-mono" placeholder="(optional)" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Env allowlist</span>
            <input value={envAllowlistText} onChange={(e) => setEnvAllowlistText(e.target.value)} className="fw-input font-mono" placeholder="PATH, HOME" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Timeout (seconds)</span>
            <input type="number" value={timeoutS} onChange={(e) => setTimeoutS(e.target.value)} className="fw-input" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Max output (KB)</span>
            <input type="number" value={maxOutputKb} onChange={(e) => setMaxOutputKb(e.target.value)} className="fw-input" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Max concurrent runs</span>
            <input type="number" min={1} max={16} value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} className="fw-input" />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6">
          <Toggle on={enabled} onChange={setEnabled} label="Enabled" />
          <Toggle on={allowNonAdmin} onChange={setAllowNonAdmin} label="Allow non-admins to run" />
        </div>

        {localError && <p className="mt-4 text-sm text-red-400">{localError}</p>}

        <div className="mt-6 flex justify-end gap-2.5">
          <button onClick={onClose} className="fw-btn-ghost h-10 px-5">
            Cancel
          </button>
          <button onClick={submit} disabled={pending || noExecutables} className="fw-btn-primary h-10 px-5">
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Create command'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CommandRow({ c, onEdit }: { c: AdminCommandDto; onEdit: () => void }) {
  const del = useDeleteCommand()
  const onDelete = () => {
    if (window.confirm(`Delete "${c.name}"? This removes the command and its run history.`)) del.mutate(c.id)
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-ink">{c.name}</span>
          <span className="rounded bg-surface-2 px-1.5 py-px font-mono text-[10px] text-muted">{c.executable}</span>
          {!c.enabled && <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] text-muted">disabled</span>}
          {c.isInternal && <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] text-muted">internal</span>}
        </div>
        {c.description && <div className="mt-0.5 truncate text-xs text-muted">{c.description}</div>}
        <div className="mt-0.5 font-mono text-[10.5px] text-muted">
          {c.params.length} param{c.params.length === 1 ? '' : 's'} · {c.allowNonAdmin ? 'all users' : 'admins only'}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 text-sm">
        <button onClick={onEdit} disabled={c.isInternal} className="fw-btn-ghost h-9 px-3 disabled:opacity-40" title={c.isInternal ? 'Built-in command — not editable' : undefined}>
          Edit
        </button>
        <button onClick={onDelete} disabled={del.isPending || c.isInternal} className="fw-btn-ghost h-9 px-3 hover:border-red-500 hover:text-red-400 disabled:opacity-40">
          Delete
        </button>
      </div>
    </div>
  )
}

export function AdminCommandsPage() {
  const { data: me, isLoading: meLoading } = useMe()
  const { data, isLoading } = useAdminCommands()
  const [editor, setEditor] = useState<{ initial?: AdminCommandDto } | null>(null)

  if (!meLoading && me && me.role !== 'admin') return <Navigate to="/" replace />

  const commands = data?.data ?? []
  const executables = data?.executables ?? []

  return (
    <PageShell home trail={[{ label: 'Admin' }, { label: 'Commands' }]}>
      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-6">
        <h1 className="font-head text-2xl font-semibold tracking-[-0.01em] text-ink">Commands</h1>
        <AdminTabs />
        <p className="mt-4 text-sm text-muted">
          Define server-side commands users can run from the Commands page. The executable must be allowlisted via{' '}
          <code className="font-mono">COMMAND_ALLOWED_EXECUTABLES</code> on the server.
        </p>

        <div className="mt-4">
          <button onClick={() => setEditor({})} className="fw-btn-primary h-10 px-5">
            <PlusIcon className="h-4 w-4" /> New command
          </button>
        </div>

        <div className="mt-6">
          <h2 className="fw-mono-label">Defined commands</h2>
          <div className="fw-card mt-2 divide-y divide-line">
            {isLoading ? (
              <p className="px-4 py-3 text-sm text-muted">Loading…</p>
            ) : commands.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">No commands yet — create one above.</p>
            ) : (
              commands.map((c) => <CommandRow key={c.id} c={c} onEdit={() => setEditor({ initial: c })} />)
            )}
          </div>
        </div>
      </main>

      {editor && <CommandEditor initial={editor.initial} executables={executables} onClose={() => setEditor(null)} />}
    </PageShell>
  )
}
