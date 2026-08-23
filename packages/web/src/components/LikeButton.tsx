import { useToggleLike } from '../lib/social'
import { HeartIcon } from './icons'

/** Heart toggle. Stops propagation so it works on top of a card link. */
export function LikeButton({
  id,
  liked,
  likeCount,
  variant = 'pill',
}: {
  id: string
  liked: boolean
  likeCount: number
  variant?: 'card' | 'pill'
}) {
  const toggle = useToggleLike()
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle.mutate({ id, liked })
  }
  const shared = {
    type: 'button' as const,
    onClick,
    disabled: toggle.isPending,
    'aria-pressed': liked,
    title: liked ? 'Unlike' : 'Like',
  }

  if (variant === 'card') {
    return (
      <button
        {...shared}
        className={`flex h-[26px] w-[26px] items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition ${
          liked ? 'text-accent' : 'text-white'
        }`}
      >
        <HeartIcon filled={liked} className="h-3.5 w-3.5" />
      </button>
    )
  }

  return (
    <button
      {...shared}
      className={`inline-flex h-9 items-center gap-2 rounded-theme-sm border px-4 text-[15px] transition ${
        liked ? 'border-accent/40 bg-accent-tint text-accent' : 'border-line text-ink hover:bg-surface-2'
      }`}
    >
      <HeartIcon filled={liked} className="h-[18px] w-[18px]" />
      {likeCount > 0 && <span className="font-mono text-[13px]">{likeCount}</span>}
    </button>
  )
}
