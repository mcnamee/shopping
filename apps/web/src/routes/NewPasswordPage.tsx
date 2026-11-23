import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { PasswordRules } from '../components/PasswordRules';
import { PasswordField } from '../components/TextField';
import { useToast } from '../components/Toast';
import { clearTempPassword, matchesTempPassword } from '../auth/tempPassword';
import { COPY, UNSUPPORTED_STEP_MESSAGE, newPasswordFailure } from '../lib/authCopy';
import { passwordMeetsRules } from '../lib/password';
import { returnPath, type AuthRouteState } from './routeState';

/** /new-password (docs/ux/auth.md section 2). Only reachable with a pending challenge. */
export function NewPasswordPage() {
  const { status, completeNewPassword } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showRuleErrors, setShowRuleErrors] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  // The challenge only lives in memory: a refresh (status signedOut) means it is gone.
  if (status === 'signedOut') {
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{ notice: 'session-timeout' } satisfies AuthRouteState}
      />
    );
  }
  if (status === 'signedIn') return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBanner(null);

    let pwMsg: string | null = null;
    let confirmMsg: string | null = null;
    if (!password) pwMsg = 'Enter a new password.';
    else if (matchesTempPassword(password)) pwMsg = COPY.samePassword;
    else if (!passwordMeetsRules(password)) pwMsg = COPY.passwordRules;
    if (!confirm) confirmMsg = 'Confirm your new password.';
    else if (confirm !== password) confirmMsg = "Passwords don't match.";
    setPasswordError(pwMsg);
    setConfirmError(confirmMsg);
    setShowRuleErrors(pwMsg === COPY.passwordRules);
    if (pwMsg) return passwordRef.current?.focus();
    if (confirmMsg) return confirmRef.current?.focus();

    setBusy(true);
    setShowPassword(false);
    setShowConfirm(false);
    try {
      const result = await completeNewPassword(password);
      if (result.status === 'SIGNED_IN') {
        clearTempPassword();
        toast.show("Password saved. You're signed in.");
        navigate(returnPath(undefined), { replace: true });
      } else {
        setBanner(UNSUPPORTED_STEP_MESSAGE);
      }
    } catch (err) {
      const failure = newPasswordFailure(err);
      if (failure.kind === 'expired') {
        navigate('/sign-in', {
          replace: true,
          state: { notice: 'session-timeout' } satisfies AuthRouteState,
        });
      } else if (failure.kind === 'policy') {
        setPasswordError(COPY.passwordRules);
        setShowRuleErrors(true);
        passwordRef.current?.focus();
      } else {
        setBanner(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout back={{ to: '/sign-in', label: 'Back to sign in' }}>
      <h1 className="text-2xl">Choose a new password</h1>
      <p className="mb-5 mt-1 text-base text-muted">
        Welcome to Trolley! Set a password to finish signing in.
      </p>

      <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <PasswordField
          ref={passwordRef}
          label="New password"
          name="new-password"
          autoComplete="new-password"
          enterKeyHint="next"
          value={password}
          readOnly={busy}
          error={passwordError}
          shown={showPassword}
          onShownChange={setShowPassword}
          onChange={(e) => {
            setPassword(e.target.value);
            setPasswordError(null);
          }}
          hint={
            <PasswordRules
              id="new-password-rules"
              password={password}
              showErrors={showRuleErrors}
            />
          }
        />
        <PasswordField
          ref={confirmRef}
          label="Confirm new password"
          name="confirm-password"
          autoComplete="new-password"
          enterKeyHint="go"
          value={confirm}
          readOnly={busy}
          error={confirmError}
          shown={showConfirm}
          onShownChange={setShowConfirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setConfirmError(null);
          }}
        />
        {banner && <Banner variant="error">{banner}</Banner>}
        <Button type="submit" busy={busy} busyLabel="Saving...">
          Save password
        </Button>
      </form>
    </AuthLayout>
  );
}
