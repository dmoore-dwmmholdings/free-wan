/**
 * Mirrors the web app's --fw-* tokens (packages/web/src/index.css). React Native has no
 * CSS custom properties or color-mix(), so the derived values are resolved to literals here.
 * Keep in sync with the web defaults when the brand palette changes.
 */
export const theme = {
  color: {
    bg: '#0b0b10',
    surface: '#16161d',
    surface2: '#1f1f27',
    border: 'rgba(233,233,238,0.11)',
    primary: '#6e4cff',
    primaryTint: 'rgba(110,76,255,0.15)',
    accent: '#22d3ee',
    text: '#e9e9ee',
    muted: '#9a9aa6',
    onPrimary: '#ffffff',
    danger: '#f87171',
  },
  radius: { sm: 9, md: 16, full: 999 },
  space: (n: number) => n * 4,
} as const
