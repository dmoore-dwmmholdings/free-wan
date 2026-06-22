import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Branding (Phase 8) overrides these CSS variables at runtime.
        brand: 'var(--brand-color, #7c3aed)',
      },
    },
  },
  plugins: [],
} satisfies Config
