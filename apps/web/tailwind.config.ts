import type { Config } from 'tailwindcss';

// Tokens from docs/ux/tokens.md. Colours are CSS variables (src/index.css) so dark mode
// is handled by prefers-color-scheme without `dark:` variants.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        border: 'var(--border)',
        'border-subtle': 'var(--border-subtle)',
        text: 'var(--text)',
        muted: 'var(--text-muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
          soft: 'var(--accent-soft)',
          on: 'var(--on-accent)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
          on: 'var(--on-danger)',
        },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        warning: { soft: 'var(--warning-soft)', text: 'var(--warning-text)' },
        scrim: 'var(--scrim)',
      },
      borderColor: { DEFAULT: 'var(--border-subtle)' },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem', fontWeight: '600' }],
        sm: ['0.875rem', '1.25rem'],
        base: ['1rem', '1.5rem'],
        lg: ['1.125rem', { lineHeight: '1.625rem', fontWeight: '600' }],
        xl: ['1.375rem', { lineHeight: '1.75rem', fontWeight: '700' }],
        '2xl': ['1.75rem', { lineHeight: '2.125rem', fontWeight: '700' }],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '20px' },
      minHeight: { tap: '44px', primary: '56px' },
      minWidth: { tap: '44px' },
      spacing: {
        // Tap-target sizes stay in px so the Text size setting (root font size) never shrinks them.
        11: '44px',
        12: '48px',
        'safe-top': 'var(--safe-top)',
        'safe-bottom': 'var(--safe-bottom)',
        'safe-left': 'var(--safe-left)',
        'safe-right': 'var(--safe-right)',
      },
      boxShadow: { sheet: '0 8px 24px rgba(0,0,0,.18)' },
      transitionDuration: { DEFAULT: '150ms' },
    },
  },
  plugins: [],
} satisfies Config;
