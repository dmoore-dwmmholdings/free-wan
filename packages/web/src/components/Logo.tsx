import { useBranding } from '../lib/branding'

/**
 * The FreeWAN mark: a geometric F-monogram in a rounded tile with an accent "signal" node.
 * Fills reference the live `--fw-*` tokens, so the mark recolors with the active brand preset.
 */
export function LogoMark({ size = 30, pulse = false, className }: { size?: number; pulse?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', flex: 'none' }}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="94" height="94" rx="24" fill="var(--fw-primary)" />
      <rect x="30" y="26" width="12" height="50" rx="2.5" fill="var(--fw-on-primary)" />
      <rect x="30" y="26" width="36" height="12" rx="2.5" fill="var(--fw-on-primary)" />
      <rect x="30" y="46" width="26" height="11" rx="2.5" fill="var(--fw-on-primary)" />
      <circle
        cx="74"
        cy="32"
        r="7"
        fill="var(--fw-accent)"
        className={pulse ? 'animate-fwpulse' : undefined}
        style={pulse ? { transformBox: 'fill-box', transformOrigin: 'center' } : undefined}
      />
    </svg>
  )
}

function splitWordmark(name: string): [string, string] {
  const m = name.match(/^(.+?)(WAN)$/i)
  if (m && m[1]) return [m[1], m[2]!]
  return [name, '']
}

/**
 * Mark + wordmark. Honors an uploaded logo, otherwise renders the site name with the trailing
 * "WAN" tinted in the primary color (matching the FreeWAN wordmark).
 */
export function Logo({
  size = 30,
  textSize = 18,
  pulse = false,
  showWordmark = true,
}: {
  size?: number
  textSize?: number
  pulse?: boolean
  showWordmark?: boolean
}) {
  const { data: branding } = useBranding()
  const name = branding?.siteName ?? 'FreeWAN'

  if (branding?.logoUrl) {
    return <img src={branding.logoUrl} alt={name} style={{ height: size, width: 'auto' }} className="block" />
  }

  const [head, tail] = splitWordmark(name)
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} pulse={pulse} />
      {showWordmark && (
        <span className="font-head font-semibold tracking-[-0.01em] text-ink" style={{ fontSize: textSize, lineHeight: 1 }}>
          {head}
          {tail && <span className="text-primary">{tail}</span>}
        </span>
      )}
    </span>
  )
}
