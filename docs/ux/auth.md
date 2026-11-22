# Auth screens (Stage 0)

Tokens: see `tokens.md`. Invite-only: there is no sign-up screen or link. Backend is Cognito; copy never exposes Cognito jargon.

## Shared layout (all auth screens)

- Single column, max-width 400px, centred; gutter 16px; `pt = safe-top + 48`, `pb = safe-bottom + 24`.
- Logo (trolley glyph 48px, `accent`) + wordmark "Trolley" (`text-2xl`) above the form on Sign in; other screens show a back button (44px) instead.
- Inputs: height 56px, `text-base` (16px), `border` 2px, `radius-md`, label above (always visible, `text-sm` 600; no placeholder-only labels). Error state: border `danger` + message below with alert icon (lucide `CircleAlert`), `text-sm`, `danger`.
- Primary button: full width, 56px, `text-lg`, `accent` bg, `on-accent` text. Disabled while submitting; shows spinner (lucide `Loader2`, spins) plus the busy label. Button is NOT disabled when the form is merely empty/invalid (so errors can explain); validation runs on submit.
- Form-level error: banner above the button, `danger-soft` bg, `danger` text, role="alert".
- Primary button sits directly under the last field so it stays above the on-screen keyboard; form scrolls (`scroll-padding-bottom: 96px`) so the focused field is never hidden.
- Enter key submits. `<form noValidate>` with custom messages below.

## 1. Sign in  (route `/sign-in`)

```
+--------------------------------------+ 360
|                                      |
|              [trolley]               |
|              Trolley                 |
|     Your household shopping list     |
|                                      |
|  Email                               |
|  +--------------------------------+  |
|  | you@example.com                |  |
|  +--------------------------------+  |
|  Password                            |
|  +--------------------------+-----+  |
|  | ••••••••                 | Eye |  |
|  +--------------------------+-----+  |
|                                      |
|  [        Sign in (56px)         ]   |
|                                      |
|          Forgot password?            |
|                                      |
|  Trolley is invite-only. Ask your    |
|  household admin for an account.     |
+--------------------------------------+
```

Fields
- Email: `type="email"`, `autocomplete="username"`, `inputmode="email"`, `autocapitalize="none"`, `autocorrect="off"`, `spellcheck="false"`, `enterkeyhint="next"`, `name="email"`.
- Password: `type="password"` / `"text"` when shown, `autocomplete="current-password"`, `enterkeyhint="go"`, `name="password"`. Show/hide toggle: 44x44 icon button inside the field's right edge, lucide `Eye` / `EyeOff`, `aria-label="Show password"` / `"Hide password"`, `aria-pressed`. Toggling keeps focus and caret in the input. Password auto-hides again after submit.
- "Forgot password?": text link-button, 44px tall, centred, `accent`, navigates to Forgot password and carries over the email value.

Focus: on load, focus Email (skip if browser autofill already populated both). After a failed sign-in, focus the Password field and select its content. Validation failure focuses the first invalid field.

States
| State | Behaviour / copy |
|---|---|
| Idle | as wireframe |
| Submitting | button label "Signing in..." with spinner; inputs read-only; toggle still works |
| Success | no success screen; route to `/` (Lists). If a new-password challenge is returned, route to Set new password |
| Empty email | "Enter your email address." |
| Invalid email | "That email address doesn't look right." |
| Empty password | "Enter your password." |
| Wrong credentials | banner: "Incorrect email or password. Please try again." (same message for unknown user, no enumeration) |
| Too many attempts | banner: "Too many attempts. Wait a few minutes, then try again." |
| Network / server | banner: "Can't reach Trolley right now. Check your connection and try again." |
| Offline | same as network; button remains enabled |

## 2. Set new password  (route `/new-password`)

Shown when sign-in returns a "new password required" challenge (first login with an admin-set temporary password). Not reachable otherwise (redirect to `/sign-in`). The in-memory challenge session is lost on refresh: then redirect to Sign in with banner (info style): "Your session timed out. Sign in again with your temporary password."

```
+--------------------------------------+
|  [<] Back to sign in                 |
|                                      |
|  Choose a new password               |
|  Welcome to Trolley! Set a password  |
|  to finish signing in.               |
|                                      |
|  New password                        |
|  +--------------------------+-----+  |
|  |                          | Eye |  |
|  +--------------------------+-----+  |
|  Your password needs:                |
|   [x] At least 8 characters          |
|   [x] An uppercase letter (A-Z)      |
|   [ ] A lowercase letter (a-z)       |
|   [ ] A number (0-9)                 |
|                                      |
|  Confirm new password                |
|  +--------------------------------+  |
|  |                                |  |
|  +--------------------------------+  |
|                                      |
|  [     Save password (56px)      ]   |
+--------------------------------------+
```

Fields
- New password: `type="password"`, `autocomplete="new-password"`, `enterkeyhint="next"`, show/hide toggle as above.
- Confirm: `type="password"`, `autocomplete="new-password"`, `enterkeyhint="go"`. (Do not include the temporary password field; it is already held in the challenge.)
- Rules checklist: `<ul aria-live="polite">`. Each item has icon + text: unmet = lucide `Circle` in `text-muted`; met = lucide `CircleCheck` in `success` (and visually-hidden "met"/"not met"). Updates live as the user types. Rules are shown from the start (neutral, not red) and turn red only after a failed submit (unmet items use `danger` + `CircleAlert`).
- Rules: min 8 chars, >= 1 uppercase, >= 1 lowercase, >= 1 number.

Focus: New password on load. Back link returns to Sign in and discards the challenge.

States
| State | Behaviour / copy |
|---|---|
| Idle | as wireframe |
| Submitting | "Saving..." with spinner; inputs read-only |
| Success | route to `/` (Lists) already signed in; a toast for 4s: "Password saved. You're signed in." |
| Rules unmet (submit) | field error: "Your password doesn't meet all the rules below." |
| Mismatch | confirm error: "Passwords don't match." |
| Empty | "Enter a new password." / "Confirm your new password." |
| Same as temporary | banner: "Choose a different password from your temporary one." |
| Expired challenge | redirect to Sign in with banner: "Your session timed out. Sign in again with your temporary password." |
| Network / server | "Can't reach Trolley right now. Check your connection and try again." |

## 3. Forgot password  (route `/forgot-password`, two steps, same route; step held in state)

### Step 1: Request code

```
+--------------------------------------+
|  [<] Back to sign in                 |
|                                      |
|  Reset your password                 |
|  Enter your email and we'll send     |
|  you a 6-digit code.                 |
|                                      |
|  Email                               |
|  +--------------------------------+  |
|  | you@example.com                |  |
|  +--------------------------------+  |
|                                      |
|  [      Send code (56px)         ]   |
+--------------------------------------+
```

- Email: same attributes as Sign in (`autocomplete="username"`, `inputmode="email"`), prefilled from Sign in. Focus on load if empty; otherwise focus the button.
- Submitting: "Sending..." with spinner.
- Success: advance to Step 2. Always shows the same result whether or not the email exists.
- Errors: "Enter your email address." / "That email address doesn't look right." / rate limit "Too many requests. Wait a few minutes, then try again." / network copy as above.

### Step 2: Enter code and new password

```
+--------------------------------------+
|  [<] Use a different email           |
|                                      |
|  Check your email                    |
|  If an account exists for            |
|  you@example.com, we've sent a       |
|  6-digit code. It can take a minute. |
|                                      |
|  Code                                |
|  +--------------------------------+  |
|  | 123456                         |  |
|  +--------------------------------+  |
|  New password            [Eye]       |
|  +--------------------------------+  |
|  Your password needs: (checklist)    |
|                                      |
|  [   Reset password (56px)       ]   |
|                                      |
|        Didn't get a code? Resend     |
+--------------------------------------+
```

- Code: `type="text"`, `inputmode="numeric"`, `autocomplete="one-time-code"`, `pattern="[0-9]*"`, `maxlength=6`, `enterkeyhint="next"`, large centred digits (`text-xl`, letter-spacing .2em). Focus on step entry. Strip non-digits on paste.
- New password: `autocomplete="new-password"`, `enterkeyhint="go"`, show/hide toggle, same live rules checklist as Set new password. No confirm field (the show toggle is the check; reduces typing on mobile).
- Resend: text button, 44px; disabled for 30s after each send with label "Resend code in 24s" counting down; on resend toast "New code sent."

States
| State | Behaviour / copy |
|---|---|
| Submitting | "Resetting..." with spinner |
| Success | route to `/sign-in` with email prefilled and success banner (`success-soft`): "Password reset. Sign in with your new password." Focus Password field |
| Empty code | "Enter the 6-digit code from your email." |
| Short code | "The code is 6 digits." |
| Wrong code | "That code isn't right. Check your email and try again." (focus Code, select) |
| Expired code | "That code has expired. Tap Resend to get a new one." |
| Rules unmet | "Your password doesn't meet all the rules below." |
| Too many attempts | "Too many attempts. Wait a few minutes, then try again." |
| Network / server | "Can't reach Trolley right now. Check your connection and try again." |

## Accessibility notes
- One `<h1>` per screen; errors use `aria-describedby` on the input and `aria-invalid="true"`; banners `role="alert"`; success banners `role="status"`.
- Password managers: keep `name`/`id` stable; the email field is always `autocomplete="username"` so managers pair it with the password.
- All text and icon contrast per `tokens.md`.
