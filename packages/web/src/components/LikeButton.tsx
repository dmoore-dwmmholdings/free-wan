import { useToggleLike } from '../lib/social'
import { HeartIcon } from './icons'

/** Heart toggle with count. Stops propagation so it works on top of a card link. */
export function LikeButton({
  id,
  liked,
  likeCount,
  size = 'sm',
}: {
  id: string
  liked: boolean
  likeCount: number
  size?: 'sm' | 'lg'
}) {
  const toggle = useToggleLike()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggle.mutate({ id, liked })
      }}
      disabled={toggle.isPending}
      aria-pressed={liked}
      title={liked ? 'Unlike' : 'Like'}
      className={`inline-flex items-center gap-1 rounded ${
        size === 'lg' ? 'px-3 py-1.5 text-base' : 'px-1.5 py-0.5 text-xs'
      } ${liked ? 'text-red-400' : 'text-neutral-300'} bg-black/60 hover:text-red-300`}
    >
      <HeartIcon filled={liked} className={size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5'} />
      {likeCount > 0 && <span>{likeCount}</span>}
    </button>
  )
}
