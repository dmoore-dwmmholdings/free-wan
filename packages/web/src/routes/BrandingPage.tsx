import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  BRANDING_PRESETS,
  BRANDING_HEADING_FONTS,
  BRANDING_BODY_FONTS,
  DEFAULT_BRANDING,
  type Branding,
  type UpdateBrandingRequest,
} from '@free-wan/shared'
import { PageShell } from '../components/AppLayout'
import { AdminTabs } from '../components/AdminTabs'
import { LogoMark, Logo } from '../components/Logo'
import { HeartIcon } from '../components/icons'
import { useMe } from '../lib/auth'
import { useBranding, useUpdateBranding, useUploadAsset } from '../lib/branding'
import { applyBrandingVars, fontStack } from '../lib/theme'

const COLOR_FIELDS: { k: keyof Branding['colors']; n: string }[] = [
  { k: 'primary', n: 'Primary' },
  { k: 'accent', n: 'Accent' },
  { k: 'background', n: 'Background' },
  { k: 'surface', n: 'Surface' },
  { k: 'text', n: 'Text' },
]

const MODES: Branding['mode'][] = ['light', 'dark', 'system']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Dropzone({ label, children, onFile, accept }: { label: string; children: React.ReactNode; onFile: (f: File) => void; accept: string }) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <span className="fw-mono-label">{label}</span>
      <label className="flex h-[62px] cursor-pointer items-center gap-2.5 rounded-theme-sm border border-dashed border-line bg-surface px-3">
        {children}
        <span className="text-xs font-semibold text-primary-strong">Replace</span>
        <input type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
    </div>
  )
}

export function BrandingPage() {
  const { data: me, isLoading: meLoading } = useMe()
  const { data: branding } = useBranding()
  const update = useUpdateBranding()
  const upload = useUploadAsset()
  const [draft, setDraft] = useState<Branding | null>(null)
  const savedRef = useRef<Branding | undefined>(branding)
  savedRef.current = branding

  useEffect(() => {
    if (branding && !draft) setDraft(branding)
  }, [branding, draft])

  // Live preview: the draft drives the real tokens app-wide while editing…
  useEffect(() => {
    if (draft) applyBrandingVars(document.documentElement, draft)
  }, [draft])
  // …and unsaved edits are reverted to the saved branding when leaving the page.
  useEffect(() => () => { if (savedRef.current) applyBrandingVars(document.documentElement, savedRef.current) }, [])

  if (!meLoading && me && me.role !== 'admin') return <Navigate to="/" replace />
  if (!draft) {
    return (
      <PageShell home trail={[{ label: 'Admin' }, { label: 'Branding' }]}>
        <p className="p-[22px] text-muted">Loading…</p>
      </PageShell>
    )
  }

  const setColor = (k: keyof Branding['colors'], v: string) => setDraft({ ...draft, colors: { ...draft.colors, [k]: v } })
  const setFont = (kind: 'heading' | 'body', name: string) => setDraft({ ...draft, fonts: { ...draft.fonts, [kind]: name } })

  const applyPreset = (name: string) => {
    const p = BRANDING_PRESETS[name]
    if (p) setDraft({ ...draft, theme: name, mode: p.mode, colors: p.colors, radius: p.radius, fonts: { ...draft.fonts, heading: p.fonts.heading, body: p.fonts.body } })
  }

  const save = () => {
    const body: UpdateBrandingRequest = {
      siteName: draft.siteName,
      theme: draft.theme,
      mode: draft.mode,
      colors: draft.colors,
      radius: draft.radius,
      fonts: { heading: draft.fonts.heading, body: draft.fonts.body },
    }
    update.mutate(body, { onSuccess: () => { savedRef.current = draft } })
  }

  const reset = () => {
    const next = { ...DEFAULT_BRANDING, logoUrl: draft.logoUrl, faviconUrl: draft.faviconUrl }
    setDraft(next)
    update.mutate(
      { siteName: DEFAULT_BRANDING.siteName, theme: DEFAULT_BRANDING.theme, mode: DEFAULT_BRANDING.mode, colors: DEFAULT_BRANDING.colors, radius: DEFAULT_BRANDING.radius, fonts: { heading: DEFAULT_BRANDING.fonts.heading, body: DEFAULT_BRANDING.fonts.body } },
      { onSuccess: () => { savedRef.current = next } },
    )
  }

  const radiusPx = parseInt(draft.radius) || 0
  const liveRight = (
    <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-accent">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--fw-accent)' }} />
      LIVE · applies app-wide
    </span>
  )

  return (
    <PageShell home trail={[{ label: 'Admin' }, { label: 'Branding' }]} headerRight={liveRight}>
      <div className="px-4 pt-4 sm:px-[22px]">
        <AdminTabs />
      </div>
      <div className="flex flex-col gap-6 p-4 pt-2 sm:p-[22px] sm:pt-2 lg:flex-row">
        {/* Editor */}
        <div className="flex w-full flex-none flex-col gap-4 lg:w-[438px]">
          <div className="flex flex-col gap-3">
            <span className="fw-mono-label">Preset · click to apply</span>
            <div className="flex flex-wrap gap-2.5">
              {Object.keys(BRANDING_PRESETS).map((key) => {
                const p = BRANDING_PRESETS[key]!
                const active = draft.theme === key
                return (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    className={`flex items-center gap-2 rounded-theme-sm border px-3 py-2 text-[12.5px] font-semibold transition ${
                      active ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-ink hover:border-muted'
                    }`}
                  >
                    <span
                      className="h-3.5 w-3.5 flex-none rounded-[5px]"
                      style={{
                        background: `linear-gradient(135deg, ${p.colors.primary} 0 50%, ${p.colors.accent} 50% 100%)`,
                        boxShadow: active ? '0 0 0 1.5px var(--fw-on-primary)' : 'none',
                      }}
                    />
                    {cap(key)}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="flex flex-col gap-2">
            <span className="fw-mono-label">Site name</span>
            <input value={draft.siteName} onChange={(e) => setDraft({ ...draft, siteName: e.target.value })} className="fw-input" />
          </label>

          <div className="flex gap-3.5">
            <Dropzone label="Logo" accept="image/*" onFile={(f) => upload.mutate({ kind: 'logo', file: f })}>
              <LogoMark size={30} />
            </Dropzone>
            <Dropzone label="Favicon" accept="image/*,.ico" onFile={(f) => upload.mutate({ kind: 'favicon', file: f })}>
              <LogoMark size={22} />
            </Dropzone>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="fw-mono-label">Colors</span>
            <div className="grid grid-cols-2 gap-2">
              {COLOR_FIELDS.map(({ k, n }) => (
                <label key={k} className="flex h-[34px] cursor-pointer items-center gap-2.5 rounded-theme-sm border border-line bg-surface px-2.5">
                  <span className="h-6 w-6 flex-none rounded-md border border-line" style={{ background: draft.colors[k] }} />
                  <span className="flex-1 text-[12.5px] text-ink">{n}</span>
                  <span className="font-mono text-[10.5px] uppercase text-muted">{draft.colors[k]}</span>
                  <input type="color" value={draft.colors[k]} onChange={(e) => setColor(k, e.target.value)} className="sr-only" />
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-[18px]">
            <div className="flex flex-1 flex-col gap-2.5">
              <span className="fw-mono-label">Mode</span>
              <div className="flex gap-[3px] rounded-theme-sm border border-line bg-surface p-[3px]">
                {MODES.map((m) => (
                  <button
                    key={m}
                    onClick={() => setDraft({ ...draft, mode: m })}
                    className={`flex-1 rounded-theme-sm py-1.5 text-center text-[12.5px] font-semibold capitalize transition ${
                      draft.mode === m ? 'bg-primary text-on-primary' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-2.5">
              <span className="fw-mono-label">Corner radius · {draft.radius}</span>
              <div className="flex h-[34px] items-center">
                <input
                  type="range"
                  min={0}
                  max={24}
                  value={radiusPx}
                  onChange={(e) => setDraft({ ...draft, radius: `${e.target.value}px` })}
                  aria-label="Corner radius"
                  className="w-full accent-primary"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="fw-mono-label">Fonts</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-[50px] flex-none font-mono text-[10px] text-muted">Heading</span>
              {BRANDING_HEADING_FONTS.map((name) => {
                const active = draft.fonts.heading === name
                return (
                  <button
                    key={name}
                    onClick={() => setFont('heading', name)}
                    style={{ fontFamily: fontStack(name) }}
                    className={`rounded-theme-sm border px-3 py-1.5 text-[13px] font-semibold leading-none transition ${active ? 'border-primary bg-primary-tint text-primary-strong' : 'border-line bg-surface text-ink'}`}
                  >
                    {name.split(' ')[0]}
                  </button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-[50px] flex-none font-mono text-[10px] text-muted">Body</span>
              {BRANDING_BODY_FONTS.map((name) => {
                const active = draft.fonts.body === name
                return (
                  <button
                    key={name}
                    onClick={() => setFont('body', name)}
                    style={{ fontFamily: fontStack(name) }}
                    className={`rounded-theme-sm border px-3 py-1.5 text-[13px] font-semibold leading-none transition ${active ? 'border-primary bg-primary-tint text-primary-strong' : 'border-line bg-surface text-ink'}`}
                  >
                    {name.split(' ')[0]}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2.5">
            <button onClick={save} disabled={update.isPending} className="fw-btn-primary h-11 flex-1">
              Save changes
            </button>
            <button onClick={reset} className="fw-btn-ghost h-11 px-4">
              Reset
            </button>
            {update.isSuccess && <span className="text-sm text-accent">Saved</span>}
          </div>
        </div>

        {/* Live preview */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <span className="fw-mono-label">Live preview</span>
          <div className="flex flex-1 flex-col overflow-hidden rounded-theme border border-line bg-bg">
            <div className="flex h-[52px] flex-none items-center gap-3 border-b border-line bg-surface px-5">
              <Logo size={26} textSize={17} />
              <div className="flex-1" />
              <span className="text-xs font-semibold text-primary-strong">Liked</span>
              <span className="text-xs text-muted">Collections</span>
              <span className="h-7 w-7 rounded-full" style={{ background: 'linear-gradient(135deg, var(--fw-primary), var(--fw-accent))' }} />
            </div>
            <div className="flex flex-1 flex-col gap-5 p-6">
              <div className="grid grid-cols-5 gap-3.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="rounded-theme-sm bg-surface-2" style={{ aspectRatio: '2 / 3' }} />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="fw-btn-primary h-[42px] px-6">Play</span>
                <span className="fw-btn-ghost h-[42px] px-5">Add to collection</span>
                <span className="flex h-[42px] w-[42px] items-center justify-center rounded-theme-sm border border-line text-accent">
                  <HeartIcon filled className="h-4 w-4" />
                </span>
              </div>
              <div className="fw-card flex flex-col gap-2.5 p-5">
                <div className="font-head text-[23px] font-semibold tracking-[-0.01em] text-ink">The quick brown library</div>
                <div className="text-sm leading-relaxed text-ink">
                  Headings render in <strong>{draft.fonts.heading}</strong>, body and interface in {draft.fonts.body}. Every
                  surface — cards, buttons, inputs, the player — recolors the instant you pick a preset.
                </div>
                <div className="font-mono text-xs text-muted">mono · 3840×2160 · H.264 · 24:18 / 1:42:10</div>
                <div className="mt-1.5 flex gap-2">
                  <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] text-on-primary">4K</span>
                  <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink">HDR</span>
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-bg" style={{ background: 'var(--fw-accent)' }}>
                    New
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
