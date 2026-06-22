import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { BRANDING_PRESETS, DEFAULT_BRANDING, type Branding, type UpdateBrandingRequest } from '@free-wan/shared'
import { AppHeader } from '../components/AppHeader'
import { useMe } from '../lib/auth'
import { useBranding, useUpdateBranding, useUploadAsset } from '../lib/branding'

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-neutral-300">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-12 rounded border border-neutral-700 bg-transparent" />
    </label>
  )
}

export function BrandingPage() {
  const { data: me, isLoading: meLoading } = useMe()
  const { data: branding } = useBranding()
  const update = useUpdateBranding()
  const upload = useUploadAsset()
  const [draft, setDraft] = useState<Branding | null>(null)

  useEffect(() => {
    if (branding && !draft) setDraft(branding)
  }, [branding, draft])

  // Live preview: reflect the draft primary in the running app immediately.
  useEffect(() => {
    if (draft) document.documentElement.style.setProperty('--brand-color', draft.colors.primary)
  }, [draft])

  if (!meLoading && me && me.role !== 'admin') return <Navigate to="/" replace />
  if (!draft) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100">
        <AppHeader />
        <p className="p-6 text-neutral-500">Loading…</p>
      </div>
    )
  }

  const setColor = (k: keyof Branding['colors'], v: string) =>
    setDraft({ ...draft, colors: { ...draft.colors, [k]: v } })

  const applyPreset = (name: string) => {
    const p = BRANDING_PRESETS[name]
    if (p) setDraft({ ...draft, theme: name, mode: p.mode, colors: p.colors, radius: p.radius })
  }

  const save = () => {
    const body: UpdateBrandingRequest = {
      siteName: draft.siteName,
      theme: draft.theme,
      mode: draft.mode,
      colors: draft.colors,
      radius: draft.radius,
    }
    update.mutate(body)
  }

  const reset = () => {
    setDraft({ ...DEFAULT_BRANDING, logoUrl: draft.logoUrl, faviconUrl: draft.faviconUrl })
    update.mutate({
      siteName: DEFAULT_BRANDING.siteName,
      theme: DEFAULT_BRANDING.theme,
      mode: DEFAULT_BRANDING.mode,
      colors: DEFAULT_BRANDING.colors,
      radius: DEFAULT_BRANDING.radius,
    })
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="mx-auto max-w-xl px-6 py-6">
        <h1 className="text-2xl font-semibold">Branding</h1>

        <label className="mt-5 block text-sm">
          <span className="mb-1 block text-neutral-300">Site name</span>
          <input
            value={draft.siteName}
            onChange={(e) => setDraft({ ...draft, siteName: e.target.value })}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-brand"
          />
        </label>

        <div className="mt-5">
          <span className="mb-2 block text-sm text-neutral-300">Preset</span>
          <div className="flex flex-wrap gap-2">
            {Object.keys(BRANDING_PRESETS).map((name) => (
              <button
                key={name}
                onClick={() => applyPreset(name)}
                className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${draft.theme === name ? 'border-brand text-brand' : 'border-neutral-700 text-neutral-300'}`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-4 sm:grid-cols-2">
          <Swatch label="Primary" value={draft.colors.primary} onChange={(v) => setColor('primary', v)} />
          <Swatch label="Accent" value={draft.colors.accent} onChange={(v) => setColor('accent', v)} />
          <Swatch label="Background" value={draft.colors.background} onChange={(v) => setColor('background', v)} />
          <Swatch label="Surface" value={draft.colors.surface} onChange={(v) => setColor('surface', v)} />
          <Swatch label="Text" value={draft.colors.text} onChange={(v) => setColor('text', v)} />
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-neutral-300">Mode</span>
            <select
              value={draft.mode}
              onChange={(e) => setDraft({ ...draft, mode: e.target.value as Branding['mode'] })}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4 text-sm">
          <label className="cursor-pointer text-neutral-300">
            Upload logo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload.mutate({ kind: 'logo', file: e.target.files[0] })}
            />
          </label>
          <label className="cursor-pointer text-neutral-300">
            Upload favicon
            <input
              type="file"
              accept="image/*,.ico"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload.mutate({ kind: 'favicon', file: e.target.files[0] })}
            />
          </label>
          {branding?.logoUrl && <img src={branding.logoUrl} alt="logo" className="h-8 w-auto" />}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button onClick={save} disabled={update.isPending} className="rounded-lg bg-brand px-5 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50">
            Save
          </button>
          <button onClick={reset} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-red-500 hover:text-red-400">
            Reset to default
          </button>
          {update.isSuccess && <span className="text-sm text-green-400">Saved</span>}
        </div>
      </main>
    </div>
  )
}
