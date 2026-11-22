import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { PasswordRules } from '../components/PasswordRules';
import { PasswordField, TextField } from '../components/TextField';
import { useToast } from '../components/Toast';
import { COPY, requestCodeErrorMessage, resetErrorFailure, validateEmail } from '../lib/authCopy';
import { passwordMeetsRules } from '../lib/password';
import type { AuthRouteState } from './routeState';

const RESEND_SECONDS = 30;

/** /forgot-password (docs/ux/auth.md section 3): two steps on one route. */
export function ForgotPasswordPage() {
  const { resetPassword, confirmResetPassword } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const routeState = (useLocation().state as AuthRouteState | null) ?? {};

  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState(routeState.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showRuleErrors, setShowRuleErrors] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Focus management per step: step 1 email (or the button when prefilled), step 2 code.
  useEffect(() => {
    if (step === 'request') {
      if (emailRef.current?.value) sendRef.current?.focus();
      else emailRef.current?.focus();
    } else {
      codeRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBanner(null);
    const msg = validateEmail(email);
    setEmailError(msg);
    if (msg) return emailRef.current?.focus();

    setBusy(true);
    try {
      await resetPassword(email.trim());
      setCooldown(RESEND_SECONDS);
      setStep('confirm');
    } catch (err) {
      setBanner(requestCodeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy || cooldown > 0) return;
    setBanner(null);
    try {
      await resetPassword(email.trim());
      setCooldown(RESEND_SECONDS);
      toast.show('New code sent.');
    } catch (err) {
      setBanner(requestCodeErrorMessage(err));
    }
  }

  async function confirmReset(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBanner(null);

    let codeMsg: string | null = null;
    let pwMsg: string | null = null;
    if (!code) codeMsg = 'Enter the 6-digit code from your email.';
    else if (code.length < 6) codeMsg = 'The code is 6 digits.';
    if (!password) pwMsg = 'Enter a new password.';
    else if (!passwordMeetsRules(password)) pwMsg = COPY.passwordRules;
    setCodeError(codeMsg);
    setPasswordError(pwMsg);
    setShowRuleErrors(Boolean(pwMsg && password));
    if (codeMsg) return codeRef.current?.focus();
    if (pwMsg) return passwordRef.current?.focus();

    setBusy(true);
    setShowPassword(false);
    try {
      await confirmResetPassword(email.trim(), code, password);
      navigate('/sign-in', {
        replace: true,
        state: { email: email.trim(), notice: 'reset-success' } satisfies AuthRouteState,
      });
    } catch (err) {
      const failure = resetErrorFailure(err);
      if (failure.kind === 'code') {
        setCodeError(failure.message);
        codeRef.current?.focus();
        codeRef.current?.select();
      } else if (failure.kind === 'password') {
        setPasswordError(failure.message);
        setShowRuleErrors(true);
        passwordRef.current?.focus();
      } else {
        setBanner(failure.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === 'request') {
    return (
      <AuthLayout
        back={{ to: '/sign-in', label: 'Back to sign in', state: { email: email.trim() } }}
      >
        <h1 className="text-2xl">Reset your password</h1>
        <p className="mb-5 mt-1 text-base text-muted">
          Enter your email and we&apos;ll send you a 6-digit code.
        </p>
        {routeState.notice === 'reset-required' && (
          <Banner variant="info" className="mb-4">
            You need to set a new password before you can sign in.
          </Banner>
        )}
        <form noValidate onSubmit={(e) => void sendCode(e)} className="space-y-4">
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
            enterKeyHint="go"
            placeholder="you@example.com"
            value={email}
            readOnly={busy}
            error={emailError}
            onChange={(e) => setEmail(e.target.value)}
          />
          {banner && <Banner variant="error">{banner}</Banner>}
          <Button ref={sendRef} type="submit" busy={busy} busyLabel="Sending...">
            Send code
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      back={{
        label: 'Use a different email',
        onClick: () => {
          setBanner(null);
          setStep('request');
        },
      }}
    >
      <h1 className="text-2xl">Check your email</h1>
      <p className="mb-5 mt-1 text-base text-muted">
        If an account exists for <span className="break-all font-semibold">{email.trim()}</span>,
        we&apos;ve sent a 6-digit code. It can take a minute.
      </p>
      <form noValidate onSubmit={(e) => void confirmReset(e)} className="space-y-4">
        <TextField
          ref={codeRef}
          label="Code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          enterKeyHint="next"
          value={code}
          readOnly={busy}
          error={codeError}
          inputClassName="text-center text-xl tracking-[0.2em]"
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            setCodeError(null);
          }}
        />
        <PasswordField
          ref={passwordRef}
          label="New password"
          name="new-password"
          autoComplete="new-password"
          enterKeyHint="go"
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
              id="reset-password-rules"
              password={password}
              showErrors={showRuleErrors}
            />
          }
        />
        {banner && <Banner variant="error">{banner}</Banner>}
        <Button type="submit" busy={busy} busyLabel="Resetting...">
          Reset password
        </Button>
      </form>
      <div className="mt-2 text-center">
        <button
          type="button"
          disabled={cooldown > 0}
          onClick={() => void resend()}
          className="min-h-tap px-3 text-base font-semibold text-accent disabled:text-muted"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Didn't get a code? Resend"}
        </button>
      </div>
    </AuthLayout>
  );
}
