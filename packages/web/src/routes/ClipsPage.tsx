import { AppHeader } from '../components/AppHeader'
import { ClipCard } from '../components/ClipCard'
import { useClips } from '../lib/clips'

export function ClipsPage() {
  const { data, isLoading } = useClips()
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AppHeader />
      <main className="px-6 py-6">
        <h1 className="text-2xl font-semibold">Clips</h1>
        <div className="mt-4">
          {isLoading ? (
            <p className="text-neutral-500">Loading…</p>
          ) : data && data.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {data.data.map((clip) => (
                <ClipCard key={clip.id} clip={clip} />
              ))}
            </div>
          ) : (
            <p className="py-12 text-center text-neutral-500">
              No clips yet. Open a video and choose “Make a clip” to create a looping range.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
