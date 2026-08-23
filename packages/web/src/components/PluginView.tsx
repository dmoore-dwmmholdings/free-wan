import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BlockTone, UiBlock, UiView } from '@free-wan/shared'
import { ChevronDownIcon } from './icons'

export interface PluginActionPayload {
  action: string
  value?: unknown
  fields: Record<string, unknown>
}

/**
 * Renders a plugin's declarative UI "block kit" with native, design-token-styled components.
 * No third-party HTML/JS is injected, so the strict CSP is unaffected. Named input blocks are
 * tracked in local form state and submitted with every button action.
 */
export function PluginView({
  view,
  onAction,
  busy,
}: {
  view: UiView
  onAction: (payload: PluginActionPayload) => void
  busy?: boolean
}) {
  const blocks = useMemo(() => (Array.isArray(view) ? view : [view]), [view])
  const seeded = useMemo(() => seedFields(blocks), [blocks])
  const [fields, setFields] = useState<Record<string, unknown>>(seeded)

  // Merge server defaults with existing values, preferring what the user has already entered. This
  // keeps in-progress input intact when a live (polling) panel re-renders, while still picking up
  // any newly-introduced fields from the server.
  useEffect(() => setFields((prev) => ({ ...seeded, ...prev })), [seeded])

  const setField = (name: string, value: unknown) => setFields((f) => ({ ...f, [name]: value }))
  const fire = (action: string, value?: unknown) => onAction({ action, value, fields })

  return (
    <div className="flex flex-col gap-3.5">
      {blocks.map((b, i) => (
        <Block key={i} block={b} fields={fields} setField={setField} fire={fire} busy={busy} />
      ))}
    </div>
  )
}

interface BlockProps {
  block: UiBlock
  fields: Record<string, unknown>
  setField: (name: string, value: unknown) => void
  fire: (action: string, value?: unknown) => void
  busy?: boolean
}

function Block({ block, fields, setField, fire, busy }: BlockProps) {
  switch (block.type) {
    case 'stack': {
      const horizontal = block.direction === 'horizontal'
      return (
        <div
          className={`flex ${horizontal ? 'flex-row items-center' : 'flex-col'} ${block.wrap ? 'flex-wrap' : ''}`}
          style={{ gap: `${block.gap ?? (horizontal ? 12 : 14)}px` }}
        >
          {block.children.map((c, i) => (
            <Block key={i} block={c} fields={fields} setField={setField} fire={fire} busy={busy} />
          ))}
        </div>
      )
    }
    case 'card':
      return (
        <div className="fw-card flex flex-col gap-3.5 p-5">
          {block.title && <div className="font-head text-[15px] font-semibold text-ink">{block.title}</div>}
          {block.children.map((c, i) => (
            <Block key={i} block={c} fields={fields} setField={setField} fire={fire} busy={busy} />
          ))}
        </div>
      )
    case 'divider':
      return <div className="h-px bg-line" />
    case 'text':
      return <TextBlock text={block.text} variant={block.variant} />
    case 'badge':
      return <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${toneClass(block.tone)}`}>{block.text}</span>
    case 'stat':
      return (
        <div className="flex min-w-[110px] flex-1 flex-col gap-1.5 rounded-theme-sm border border-line bg-surface-2 px-4 py-3">
          <span className="fw-mono-label">{block.label}</span>
          <span className="font-head text-[24px] font-semibold leading-none text-ink">{block.value}</span>
          {block.hint && <span className="text-[11px] text-muted">{block.hint}</span>}
        </div>
      )
    case 'notice':
      return <Notice text={block.text} title={block.title} tone={block.tone} />
    case 'image':
      return (
        <img
          src={block.url}
          alt={block.alt ?? ''}
          className={block.rounded === false ? '' : 'rounded-theme-sm'}
          style={{ height: block.height ? `${block.height}px` : undefined, objectFit: 'cover' }}
        />
      )
    case 'mediaCard':
      return (
        <Link to={`/media/${block.mediaItemId}`} className="group block w-[150px] flex-none">
          <div className="aspect-video overflow-hidden rounded-theme-sm border border-line bg-surface-2">
            <img src={block.posterUrl ?? `/api/media/${block.mediaItemId}/poster`} alt={block.title ?? ''} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
          </div>
          {block.title && <div className="mt-1.5 truncate text-[12px] text-ink">{block.title}</div>}
        </Link>
      )
    case 'progress':
      return (
        <div className="flex flex-col gap-1.5">
          <div className="h-2.5 w-full overflow-hidden rounded-full border border-line bg-surface-2">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.max(0, Math.min(1, block.value)) * 100}%`, background: 'linear-gradient(90deg, var(--fw-primary), var(--fw-accent))' }}
            />
          </div>
          {block.label && <span className="font-mono text-[11px] text-muted">{block.label}</span>}
        </div>
      )
    case 'code':
      return <pre className="overflow-auto rounded-theme-sm border border-line p-3 font-mono text-[12px] leading-relaxed text-[#c8c8d6]" style={{ background: '#0a0a0f' }}>{block.text}</pre>
    case 'link':
      return block.external ? (
        <a href={block.href} target="_blank" rel="noreferrer" className="w-fit text-[13px] text-primary hover:underline">{block.text}</a>
      ) : (
        <Link to={block.href} className="w-fit text-[13px] text-primary hover:underline">{block.text}</Link>
      )
    case 'button':
      return (
        <button
          type="button"
          disabled={busy || block.disabled}
          onClick={() => fire(block.action, block.value)}
          className={`${block.variant === 'ghost' ? 'fw-btn-ghost' : 'fw-btn-primary'} h-10 w-fit px-4 text-[13.5px]`}
        >
          {block.text}
        </button>
      )
    case 'input':
      return (
        <FieldLabel label={block.label}>
          <input
            type={block.inputType ?? 'text'}
            value={String(fields[block.name] ?? '')}
            placeholder={block.placeholder}
            onChange={(e) => setField(block.name, e.target.value)}
            className="fw-input"
          />
        </FieldLabel>
      )
    case 'textarea':
      return (
        <FieldLabel label={block.label}>
          <textarea
            value={String(fields[block.name] ?? '')}
            placeholder={block.placeholder}
            rows={block.rows ?? 4}
            onChange={(e) => setField(block.name, e.target.value)}
            className="fw-input py-2.5"
          />
        </FieldLabel>
      )
    case 'select':
      return (
        <FieldLabel label={block.label}>
          <div className="relative">
            <select
              value={String(fields[block.name] ?? '')}
              onChange={(e) => setField(block.name, e.target.value)}
              className="fw-input w-full appearance-none pr-9"
            >
              {block.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          </div>
        </FieldLabel>
      )
    case 'toggle':
      return (
        <button type="button" onClick={() => setField(block.name, !fields[block.name])} className="flex w-fit items-center gap-2.5 text-sm text-ink">
          <span className="relative inline-block h-5 w-[34px] flex-none rounded-full transition-colors" style={{ background: fields[block.name] ? 'var(--fw-primary)' : 'var(--fw-surface-2)' }}>
            <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: fields[block.name] ? '16px' : '2px' }} />
          </span>
          {block.label}
        </button>
      )
    default:
      return null
  }
}

function TextBlock({ text, variant }: { text: string; variant?: string }) {
  switch (variant) {
    case 'heading':
      return <div className="font-head text-[19px] font-semibold tracking-[-0.01em] text-ink">{text}</div>
    case 'subheading':
      return <div className="font-head text-[14px] font-semibold text-ink">{text}</div>
    case 'muted':
      return <div className="text-[13px] text-muted">{text}</div>
    case 'mono':
      return <div className="font-mono text-[12px] text-ink">{text}</div>
    default:
      return <div className="text-[13.5px] leading-relaxed text-ink">{text}</div>
  }
}

function FieldLabel({ label, children }: { label?: string; children: React.ReactNode }) {
  if (!label) return <>{children}</>
  return (
    <label className="flex min-w-[220px] flex-1 flex-col gap-2">
      <span className="fw-mono-label">{label}</span>
      {children}
    </label>
  )
}

function Notice({ text, title, tone }: { text: string; title?: string; tone?: 'info' | 'success' | 'warn' | 'danger' }) {
  const styles: Record<string, string> = {
    info: 'border-line bg-surface-2 text-ink',
    success: 'border-accent/40 text-accent',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    danger: 'border-red-500/40 bg-red-500/10 text-red-300',
  }
  const style = tone === 'success' ? { background: 'var(--fw-accent-tint)' } : undefined
  return (
    <div className={`rounded-theme-sm border px-3.5 py-2.5 text-[12.5px] ${styles[tone ?? 'info']}`} style={style}>
      {title && <div className="font-semibold">{title}</div>}
      <div>{text}</div>
    </div>
  )
}

function toneClass(tone?: BlockTone): string {
  switch (tone) {
    case 'primary':
      return 'bg-primary-tint text-primary'
    case 'accent':
      return 'text-accent'
    case 'success':
      return 'bg-green-500/15 text-green-400'
    case 'warn':
      return 'bg-amber-500/15 text-amber-300'
    case 'danger':
      return 'bg-red-500/15 text-red-300'
    default:
      return 'bg-surface-2 text-muted'
  }
}

/** Collect named input blocks' initial values for the form state. */
function seedFields(view: UiView): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const walk = (b: UiBlock | UiView) => {
    if (Array.isArray(b)) return b.forEach(walk)
    if (!b || typeof b !== 'object') return
    const block = b as UiBlock
    if ((block.type === 'input' || block.type === 'textarea' || block.type === 'select') && 'name' in block) {
      out[block.name] = block.value ?? ''
    } else if (block.type === 'toggle') {
      out[block.name] = block.value ?? false
    }
    if ('children' in block && Array.isArray(block.children)) block.children.forEach(walk)
  }
  walk(view)
  return out
}
