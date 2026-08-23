import { LibraryLayout } from '../components/AppLayout'
import { ClipCard } from '../components/ClipCard'
import { useClips } from '../lib/clips'

export function ClipsPage() {
  const { data, isLoading } = useClips()
  return (
    <LibraryLayout>
      <div className="px-5 py-6 sm:px-[22px]">
        <div className="flex items-baseline gap-3">
          <h1 className="font-head text-[22px] font-semibold tracking-[-0.01em] text-ink">Clips</h1>
          <span className="font-mono text-[12px] text-muted">{data?.data.length ?? 0} clips</span>
        </div>
        <div className="mt-4">
          {isLoading ? (
            <p className="text-muted">Loading…</p>
          ) : data && data.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-[18px] sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {data.data.map((clip) => (
                <ClipCard key={clip.id} clip={clip} />
              ))}
            </div>
          ) : (
            <p className="py-16 text-center text-muted">No clips yet. Open a video and choose “Make a clip” to create a looping range.</p>
          )}
        </div>
      </div>
    </LibraryLayout>
  )
}
