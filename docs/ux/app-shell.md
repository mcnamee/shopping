# Authenticated app shell (Stage 0)

Tokens: see `tokens.md`. The shell wraps all signed-in routes: `/` (Lists), `/search`, `/templates`, `/settings`. Unauthenticated users are redirected to `/sign-in`.

## 1. Structure

```
+--------------------------------------+ 360
| (status bar / safe-top)              |
|  Lists                         [ ]   |  top app bar 56px + safe-top
+--------------------------------------+
| [offline / error banner, if any]     |
|                                      |
|                                      |
|           page content               |  scrolls; pb = nav height + 16
|                                      |
|                                      |
+--------------------------------------+
|  [List]   [Search]  [Copy]  [Gear]   |  bottom nav 64px + safe-bottom
|  Lists    Search  Templates Settings |
| (safe-bottom)                        |
+--------------------------------------+
```

### Top app bar
- Fixed top, `surface` bg, `shadow-nav` equivalent bottom border `border-subtle`, height 56px + `safe-top` padding.
- Title: current page title, `text-xl`, left-aligned at 16px gutter, one line, truncate. `<h1>` of the page. Right slot reserved (44px) for page actions (empty in Stage 0).
- Titles: "Lists", "Search", "Templates", "Settings".

### Bottom navigation
- Fixed bottom, full width, `surface` bg, top border `border-subtle`. `<nav aria-label="Main">` with 4 equal `<a>` items (link per route, not buttons).
- Height 64px + `max(safe-bottom, 8px)` bottom padding. Each item: min-height 56px, full quarter-width tap area (>= 80px wide on 360px), icon 24px over label `text-xs` 600, gap 4px.
- Tabs and lucide-react icons:

| Tab | Route | Icon (inactive / active) |
|---|---|---|
| Lists | `/` | `ListChecks` |
| Search | `/search` | `Search` |
| Templates | `/templates` | `LayoutTemplate` (fallback `Copy`) |
| Settings | `/settings` | `Settings` |

- Inactive: icon + label `text-muted`. Active: icon + label `accent`, label stays 600, icon stroke 2.5 (inactive 2), and an `accent-soft` pill (48x28, `radius-full`) behind the icon. Set `aria-current="page"`. Never colour alone: pill and stroke weight also change.
- Pressed: `accent-soft` background on whole item. Focus-visible ring inset.
- Tapping the active tab scrolls the page to top. Nav hides nothing and never moves when the on-screen keyboard opens (keyboard overlays; page content scrolls).
- Tab changes preserve each tab's scroll position.

## 2. Placeholder pages (Stage 0)

Shared empty-state: centred vertically in content area, icon 48px in `accent` on an `accent-soft` 96px circle, heading `text-xl`, body `text-base` `text-muted`, max-width 280px, no buttons.

```
|                                      |
|              ( icon )                |
|                                      |
|           Your lists                 |
|        are coming soon               |
|   Soon you'll build your weekly      |
|   shop here and tick things off      |
|   as you go.                         |
```

| Page | Icon | Heading | Body |
|---|---|---|---|
| Lists | `ListChecks` | Lists are coming soon | Soon you'll build your weekly shop here and tick items off as you go. |
| Search | `Search` | Search is coming soon | You'll be able to find ALDI products and add them to your list in a couple of taps. |
| Templates | `LayoutTemplate` | Templates are coming soon | Save your regular shops, like the weekly basics, and reuse them in one tap. |
| Settings | (not a placeholder) | see below | |

## 3. Settings page (`/settings`)

```
+--------------------------------------+
|  Settings                            |
+--------------------------------------+
|  ACCOUNT                             |
|  +--------------------------------+  |
|  | Signed in as                   |  |
|  | alex@example.com               |  |
|  +--------------------------------+  |
|                                      |
|  [ LogOut  Sign out        (56px) ]  |
|                                      |
|  Trolley v0.1.0                      |
+--------------------------------------+
```

- Section label `text-xs` uppercase `text-muted`. Card: `surface`, `radius-md`, padding 16. "Signed in as" `text-sm` `text-muted`; email `text-lg`, wraps/breaks anywhere (`break-all`), selectable.
- Sign out button: full width, 56px, secondary style (transparent bg, 2px `danger` border, `danger` text, lucide `LogOut` icon left). Not filled red, to avoid accidental emphasis.
- Version: `text-sm` `text-muted`, from build env.

### Sign out confirm
Bottom sheet (thumb reachable), `surface-raised`, `radius-lg` top corners, `shadow-sheet`, `scrim` behind; `role="alertdialog"`, focus trapped, initial focus on "Cancel", Esc/scrim tap/Cancel closes.

```
+--------------------------------------+
|                                      |
|  ----                                |
|  Sign out of Trolley?                |
|  You'll need your email and password |
|  to sign back in.                    |
|                                      |
|  [ Sign out (danger, 56px)       ]   |
|  [ Cancel (secondary, 56px)      ]   |
+--------------------------------------+
```

- "Sign out" uses `danger` bg + `on-danger` text. States: submitting "Signing out..." with spinner (buttons disabled). Success: clear session and cached data, route to `/sign-in`. If the network call fails, still clear local session and sign out (local sign-out always succeeds).

## 4. App loading / splash (session restore)

Shown full-screen while the auth session is restored on cold start (before routing decides between shell and `/sign-in`).

```
+--------------------------------------+
|                                      |
|                                      |
|             [trolley]                |
|             Trolley                  |
|              (spinner)               |
|                                      |
+--------------------------------------+
```

- `bg` background, glyph 72px in `accent`, wordmark `text-2xl`, small spinner (24px, `accent`) below with `role="status"` and visually-hidden "Loading".
- Matches the OS splash colour (see PWA) so there is no flash. Show spinner only after 300ms delay to avoid flicker. Do not render the shell or sign-in form until restore resolves.
- Slow (> 8s): add text beneath, `text-muted`: "Still loading... check your connection." Keep spinner.
- Restore fails (no valid session): go to `/sign-in` silently. Restore errors due to network only: if a cached session token exists keep waiting; otherwise show the error banner (below) with a "Try again" button on the splash.

## 5. Error / offline banner

Component `StatusBanner`, sits directly under the top app bar, full width, pushes content down, `role="status"` (offline) or `role="alert"` (error). Min height 48px, padding 12px 16px, icon 20px + text `text-sm` 600, optional action button (44px tall, text-style) at right.

| Variant | Colours | Icon | Copy | Action |
|---|---|---|---|---|
| Offline | `warning-soft` / `warning-text` | `WifiOff` | "You're offline. Some things won't work until you're back online." | none; auto-dismiss on `online` event |
| Error (generic) | `danger-soft` / `danger` | `CircleAlert` | "Something went wrong. Please try again." | "Try again" |
| Server unreachable | `danger-soft` / `danger` | `CircleAlert` | "Can't reach Trolley right now." | "Try again" |
| Back online | `success-soft` / `success` | `Wifi` | "You're back online." | auto-dismiss after 3s |

- One banner at a time; priority: offline > error > back online. Errors are dismissable with an X (44px) except Offline.
- Detect with `navigator.onLine` plus `online`/`offline` events; failed API calls raise the Error variant.

## 6. PWA metadata guidance

| Field | Value |
|---|---|
| `name` | Trolley |
| `short_name` | Trolley |
| `description` | Household shopping list for two |
| `start_url` | `/` |
| `scope` | `/` |
| `display` | `standalone` |
| `orientation` | `portrait` |
| `lang` | `en-AU` |
| `theme_color` | `#0B6B63` (accent, light) |
| `background_color` | `#FFFFFF` (splash) |
| `<meta name="theme-color">` | `#0B6B63` with `media="(prefers-color-scheme: light)"`, `#0F1416` with dark media |
| Apple | `apple-mobile-web-app-title` = "Trolley"; `apple-touch-icon` 180x180 |

Icon: simple shopping-trolley glyph (basket body with a diagonal handle, two wheels), flat, white on `#0B6B63` solid square, no gradient, no text, glyph centred in the middle 60%. Sizes: 192, 512 (`purpose: any`), 512 maskable (glyph within the central 80% safe zone, full-bleed background), 180 apple-touch (no transparency; iOS rounds it), favicon SVG. The in-app 48/72px glyph is the same shape as an inline SVG in `currentColor`. Do not imitate ALDI marks, colours or type.

## 7. Routing summary

| Route | Auth | Screen |
|---|---|---|
| `/sign-in`, `/forgot-password`, `/new-password` | public | see `auth.md` |
| `/`, `/search`, `/templates`, `/settings` | required | shell + page |
| anything else | n/a | redirect to `/` |
