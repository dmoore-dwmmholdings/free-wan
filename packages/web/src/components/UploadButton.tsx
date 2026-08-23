import { useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import { useUploadTargets, useUploadMedia, acceptFor } from '../lib/uploads'
import { UploadIcon } from './icons'

/** Upload photos or videos into a writable repository, straight from the library. */
export function UploadButton() {
  const { data } = useUploadTargets()
  const targets = data?.data ?? []
  const upload = useUploadMedia()
  const inputRef = useRef<HTMLInputElement>(null)
  const [repoId, setRepoId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const target = targets.find((t) => t.id === repoId) ?? targets[0]
  const effectiveRepo = target?.id ?? ''

  const onPick = () => {
    if (targets.length === 0) {
      setMsg('No writable library — uncheck “Read-only” on a repository to upload into it.')
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
          className="h-9 rounded-theme-sm border border-line bg-surface px-2.5 text-[13px] text-ink outline-none"
          title="Upload destination"
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <button onClick={onPick} disabled={upload.isPending} className="fw-btn-ghost h-9 px-3.5 text-[13px]">
        <UploadIcon className="h-4 w-4" />
        {upload.isPending ? 'Uploading…' : 'Upload'}
      </button>
      <input ref={inputRef} type="file" accept={acceptFor(target?.type)} multiple className="hidden" onChange={onFiles} />
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  )
}
