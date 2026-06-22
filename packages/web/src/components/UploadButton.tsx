import { useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import { useUploadTargets, useUploadPhotos } from '../lib/uploads'
import { UploadIcon } from './icons'

/** Upload photos into a writable image/mixed repository, straight from the library. */
export function UploadButton() {
  const { data } = useUploadTargets()
  const targets = data?.data ?? []
  const upload = useUploadPhotos()
  const inputRef = useRef<HTMLInputElement>(null)
  const [repoId, setRepoId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const effectiveRepo = repoId || targets[0]?.id || ''

  const onPick = () => {
    if (targets.length === 0) {
      setMsg('No writable photo library — uncheck “Read-only” on an image or mixed repository.')
      return
    }
    inputRef.current?.click()
  }

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0 || !effectiveRepo) return
    setMsg(null)
    try {
      const res = await upload.mutateAsync({ repositoryId: effectiveRepo, files })
      const bits = [`Uploaded ${res.uploaded}`]
      if (res.skipped.length > 0) bits.push(`skipped ${res.skipped.length}`)
      setMsg(`${bits.join(', ')} — indexing…`)
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Upload failed')
    }
  }

  return (
    <div className="flex items-center gap-2">
      {targets.length > 1 && (
        <select
          value={effectiveRepo}
          onChange={(e) => setRepoId(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          title="Upload destination"
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={onPick}
        disabled={upload.isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1 hover:border-brand disabled:opacity-50"
      >
        <UploadIcon className="h-4 w-4" />
        {upload.isPending ? 'Uploading…' : 'Upload'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
      {msg && <span className="text-xs text-neutral-400">{msg}</span>}
    </div>
  )
}
