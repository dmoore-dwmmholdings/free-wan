import type { Config } from 'tailwindcss'

// Semantic utilities resolve to the runtime `--fw-*` design tokens (set by <ThemeProvider>
// from GET /api/branding), so changing branding restyles the whole app with no rebuild.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--fw-bg)',
        surface: 'var(--fw-surface)',
        'surface-2': 'var(--fw-surface-2)',
        line: 'var(--fw-border)',
        ink: 'var(--fw-text)',
        muted: 'var(--fw-muted)',
        primary: 'var(--fw-primary)',
        accent: 'var(--fw-accent)',
        'on-primary': 'var(--fw-on-primary)',
        'primary-strong': 'var(--fw-primary-strong)',
        'primary-tint': 'var(--fw-primary-tint)',
        'primary-line': 'var(--fw-primary-line)',
        'accent-tint': 'var(--fw-accent-tint)',
        // Back-compat alias for any not-yet-migrated `*-brand` utilities.
        brand: 'var(--fw-primary)',
      },
      borderColor: {
        DEFAULT: 'var(--fw-border)',
      },
      borderRadius: {
        theme: 'var(--fw-radius)',
        'theme-sm': 'var(--fw-radius-sm)',
      },
      fontFamily: {
        head: ['var(--fw-font-head)'],
        body: ['var(--fw-font-body)'],
        mono: ['var(--fw-font-mono)'],
      },
      keyframes: {
        fwpulse: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.82)' },
        },
      },
      animation: {
        fwpulse: 'fwpulse 2.6s ease-in-out infinite',
        'fwpulse-fast': 'fwpulse 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
