/** Gradient (primary→accent) circle showing the user's initials — the header identity chip. */
export function Avatar({ name, size = 34 }: { name?: string | null; size?: number }) {
  const initials = deriveInitials(name)
  return (
    <span
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: 'linear-gradient(135deg, var(--fw-primary), var(--fw-accent))',
      }}
      className="flex flex-none items-center justify-center rounded-full font-head font-semibold text-white"
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

function deriveInitials(name?: string | null): string {
  const n = (name ?? '').trim()
  if (!n) return '?'
  const words = n.split(/[\s._-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  return n.slice(0, 2).toUpperCase()
}
