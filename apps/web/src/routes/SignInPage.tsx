import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, Link } from 'react-router';
import { useAuth } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { PasswordField, TextField } from '../components/TextField';
import { TrolleyGlyph } from '../components/TrolleyGlyph';
import { COPY, UNSUPPORTED_STEP_MESSAGE, signInErrorMessage, validateEmail } from '../lib/authCopy';
import type { AuthRouteState } from './routeState';

/** /sign-in (docs/ux/auth.md section 1). */
export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const routeState = (useLocation().state as AuthRouteState | null) ?? {};

  const [email, setEmail] = useState(routeState.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Focus: Email on load (Password after a reset), unless autofill already filled both.
  useEffect(() => {
    const e = emailRef.current;
    const p = passwordRef.current;
    if (routeState.notice === 'reset-success') p?.focus();
    else if (!(e?.value && p?.value)) e?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const focusPasswordAndSelect = () => {
    const p = passwordRef.current;
    p?.focus();
    p?.select();
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBanner(null);
    const emailMsg = validateEmail(email);
    const passwordMsg = password ? null : 'Enter your password.';
    setEmailError(emailMsg);
    setPasswordError(passwordMsg);
    if (emailMsg) return emailRef.current?.focus();
    if (passwordMsg) return passwordRef.current?.focus();

    setBusy(true);
    setShowPassword(false); // password auto-hides again after submit
    try {
      const result = await signIn(email.trim(), password);
      switch (result.status) {
        case 'SIGNED_IN':
          // PublicOnly routes into the app as soon as auth state flips.
          break;
        case 'NEW_PASSWORD_REQUIRED':
          navigate('/new-password');
          break;
        case 'RESET_PASSWORD_REQUIRED':
          navigate('/forgot-password', {
            state: { email: email.trim(), notice: 'reset-required' } satisfies AuthRouteState,
          });
          break;
        default:
          setBanner(UNSUPPORTED_STEP_MESSAGE);
      }
    } catch (err) {
      setBanner(signInErrorMessage(err));
      focusPasswordAndSelect();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-6 flex flex-col items-center text-center">
        <TrolleyGlyph size={48} />
        <h1 className="mt-2 text-2xl">Trolley</h1>
        <p className="text-base text-muted">Your household shopping list</p>
      </div>

      {routeState.notice === 'session-timeout' && !banner && (
        <Banner variant="info" className="mb-4">
          {COPY.sessionTimedOut}
        </Banner>
      )}
      {routeState.notice === 'reset-success' && !banner && (
        <Banner variant="success" className="mb-4">
          Password reset. Sign in with your new password.
        </Banner>
      )}

      <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <TextField
          ref={emailRef}
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="you@example.com"
          value={email}
          readOnly={busy}
          error={emailError}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          name="password"
          autoComplete="current-password"
          enterKeyHint="go"
          value={password}
          readOnly={busy}
          error={passwordError}
          shown={showPassword}
          onShownChange={setShowPassword}
          onChange={(e) => setPassword(e.target.value)}
        />
        {banner && <Banner variant="error">{banner}</Banner>}
        <Button type="submit" busy={busy} busyLabel="Signing in...">
          Sign in
        </Button>
      </form>

      <div className="mt-2 text-center">
        <Link
          to="/forgot-password"
          state={{ email: email.trim() } satisfies AuthRouteState}
          className="inline-flex min-h-tap items-center px-3 text-base font-semibold text-accent"
        >
          Forgot password?
        </Link>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Trolley is invite-only. Ask your household admin for an account.
      </p>
    </AuthLayout>
  );
}
