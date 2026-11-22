# Trolley design tokens

Single source of truth. Screen specs reference tokens by name (e.g. `accent`, `space-4`). Stage 0.

Principles: high contrast for bright store lighting (text >= 7:1 where possible, UI >= 4.5:1, WCAG AA minimum), tap targets >= 44px (primary actions 56px), thumb-zone placement (primary actions in the bottom half). Accent is the brand royal blue (#1B36FF; dark mode a lighter periwinkle for AA). Brand coral #FE574F and yellow #FEC917 appear only in the logo/icon (coral 3.1:1 and yellow 1.6:1 on white fail text contrast); danger red stays #B3261E, distinct from coral. Contrast: accent on bg 7.0:1 / 7.3:1, accent on accent-soft 5.9:1 / 5.9:1.

## 1. Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | #FFFFFF | #0F1416 | page background |
| `surface` | #F3F5F6 | #1A2125 | cards, inputs, nav bar |
| `surface-raised` | #FFFFFF | #222B30 | sheets, dialogs |
| `border` | #8A949B | #5F6B73 | input borders (3:1+ on bg) |
| `border-subtle` | #D5DADD | #2E383E | dividers |
| `text` | #0B1215 | #F3F6F7 | body (>= 17:1 / 16:1) |
| `text-muted` | #44525A | #A9B5BB | secondary (7.5:1 / 8:1) |
| `accent` | #1B36FF | #8C9BFF | primary buttons, active tab, links |
| `accent-strong` | #1226C4 | #B5C0FF | pressed state |
| `on-accent` | #FFFFFF | #0A1052 | text/icon on accent (7.0:1 / 6.8:1) |
| `accent-soft` | #E8EBFF | #1A2257 | active-tab pill, info banner bg |
| `danger` | #B3261E | #FF8A80 | errors, destructive (6.5:1 / 8:1) |
| `danger-soft` | #FCE8E6 | #3A1715 | error banner bg |
| `on-danger` | #FFFFFF | #2B0A08 | text on danger button |
| `success` | #1B6B2F | #6FDB8A | success text/icon |
| `success-soft` | #E1F4E5 | #14301B | success banner bg |
| `warning-soft` | #FFF1CC | #3A2E0F | offline banner bg |
| `warning-text` | #6B4A00 | #FFD36B | offline banner text |
| `focus` | #1B36FF | #8C9BFF | focus ring (2px outline, 2px offset) |
| `scrim` | rgba(0,0,0,.5) | rgba(0,0,0,.65) | dialog backdrop |

Rules: never convey state by colour alone (pair with icon or text). Dark mode follows `prefers-color-scheme`; no manual toggle in Stage 0.

## 2. Typography

System stack: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Minimum body size 16px (also stops iOS zooming on input focus). Support user text scaling (use rem).

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `text-xs` | 12 / 16 | 600 | nav labels, captions |
| `text-sm` | 14 / 20 | 400 | helper text, errors |
| `text-base` | 16 / 24 | 400 | body, inputs |
| `text-lg` | 18 / 26 | 600 | buttons, list rows |
| `text-xl` | 22 / 28 | 700 | app bar title |
| `text-2xl` | 28 / 34 | 700 | auth screen headings |

## 3. Spacing, radii, shadows, sizing

- Spacing (4px base): `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-5` 24, `space-6` 32, `space-8` 48.
- Page gutter: 16px (`space-4`).
- Radii: `radius-sm` 8 (inputs, banners), `radius-md` 12 (buttons, cards), `radius-lg` 20 (sheets, dialogs), `radius-full` 999 (pills).
- Shadows (light only; in dark use `border-subtle` instead): `shadow-nav` 0 -1px 0 border-subtle; `shadow-sheet` 0 8px 24px rgba(0,0,0,.18).
- Tap targets: `tap-min` 44px (icon buttons, links with padding); `tap-primary` 56px (primary buttons, inputs, nav items).
- Motion: 150ms ease-out; respect `prefers-reduced-motion` (disable transitions and spinner easing).

## 4. Safe areas (iPhone home-screen PWA)

- `index.html` meta: `viewport` with `viewport-fit=cover`; `apple-mobile-web-app-capable=yes`; `apple-mobile-web-app-status-bar-style=default` (use `black-translucent` only if app bar pads for the inset).
- Define `--safe-top/right/bottom/left` as `env(safe-area-inset-*, 0px)`.
- Top app bar pads top by `--safe-top`; bottom nav pads bottom by `--safe-bottom` (min 8px); page content pads left/right by `max(16px, safe-left/right)`.
- Use `100dvh`, never `100vh`.

## 5. CSS variables

```css
:root {
  --bg:#FFFFFF; --surface:#F3F5F6; --surface-raised:#FFFFFF;
  --border:#8A949B; --border-subtle:#D5DADD;
  --text:#0B1215; --text-muted:#44525A;
  --accent:#1B36FF; --accent-strong:#1226C4; --on-accent:#FFFFFF; --accent-soft:#E8EBFF;
  --danger:#B3261E; --danger-soft:#FCE8E6; --on-danger:#FFFFFF;
  --success:#1B6B2F; --success-soft:#E1F4E5;
  --warning-soft:#FFF1CC; --warning-text:#6B4A00;
  --focus:#1B36FF; --scrim:rgba(0,0,0,.5);
  --safe-top:env(safe-area-inset-top,0px); --safe-right:env(safe-area-inset-right,0px);
  --safe-bottom:env(safe-area-inset-bottom,0px); --safe-left:env(safe-area-inset-left,0px);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0F1416; --surface:#1A2125; --surface-raised:#222B30;
    --border:#5F6B73; --border-subtle:#2E383E;
    --text:#F3F6F7; --text-muted:#A9B5BB;
    --accent:#8C9BFF; --accent-strong:#B5C0FF; --on-accent:#0A1052; --accent-soft:#1A2257;
    --danger:#FF8A80; --danger-soft:#3A1715; --on-danger:#2B0A08;
    --success:#6FDB8A; --success-soft:#14301B;
    --warning-soft:#3A2E0F; --warning-text:#FFD36B;
    --focus:#8C9BFF; --scrim:rgba(0,0,0,.65);
  }
}
html { font-family: system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; background:var(--bg); color:var(--text); }
:focus-visible { outline:2px solid var(--focus); outline-offset:2px; }
```

## 6. Tailwind theme extension

```js
// tailwind.config.js
export default {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)', 'surface-raised': 'var(--surface-raised)',
        border: 'var(--border)', 'border-subtle': 'var(--border-subtle)',
        text: 'var(--text)', muted: 'var(--text-muted)',
        accent: { DEFAULT: 'var(--accent)', strong: 'var(--accent-strong)', soft: 'var(--accent-soft)', on: 'var(--on-accent)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)', on: 'var(--on-danger)' },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        warning: { soft: 'var(--warning-soft)', text: 'var(--warning-text)' },
      },
      fontFamily: { sans: ['system-ui','-apple-system','"Segoe UI"','Roboto','"Helvetica Neue"','Arial','sans-serif'] },
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
        'safe-top': 'var(--safe-top)', 'safe-bottom': 'var(--safe-bottom)',
        'safe-left': 'var(--safe-left)', 'safe-right': 'var(--safe-right)',
      },
      boxShadow: { sheet: '0 8px 24px rgba(0,0,0,.18)' },
    },
  },
};
```
