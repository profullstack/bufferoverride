'use client';

import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import styles from './auth.module.css';

const ERRORS: Record<string, string> = {
  invalid_link: 'That link was malformed. Request a new one below.',
  expired_link: 'That link has expired or was already used. Request a new one.',
  bad_state: 'That sign-in attempt could not be verified. Please start again.',
  coinpay_denied: 'CoinPay sign-in was cancelled.',
  coinpay_failed: 'CoinPay sign-in did not complete. Please try again.',
  coinpay_unconfigured: 'CoinPay sign-in is not configured on this deployment yet.',
};

/**
 * One implementation behind both /login and /signup.
 *
 * The magic link doubles as registration, so the two pages differ only in
 * wording — a visitor who has never been here and one returning both do the
 * same thing. Shipping only a "log in" page reads as "this site has no
 * accounts", which is why /signup exists at all.
 */
export function SignInPanels({ mode, error }: { mode: 'login' | 'signup'; error?: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(error ? ERRORS[error] : undefined);

  const signup = mode === 'signup';

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await fetch('/v1/auth/magic', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Always the same outcome, whether or not the address has an account.
      setSent(true);
    } catch {
      setFailure('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function usePasskey() {
    setBusy(true);
    setFailure(undefined);
    try {
      const optionsRes = await fetch('/auth/passkey/login/options', { method: 'POST' });
      const options = await optionsRes.json();
      const response = await startAuthentication({ optionsJSON: options });
      const verify = await fetch('/auth/passkey/login/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!verify.ok) throw new Error('rejected');
      window.location.href = '/';
    } catch {
      setFailure('That passkey was not accepted. Try the email link instead.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h1 className={styles.title}>{signup ? 'Create your account' : 'Sign in'}</h1>
        <p className={styles.sub}>
          {signup
            ? 'One email gets you an account. There is no password to choose, and none to lose.'
            : 'Use CoinPay, a passkey, or a one-time link sent to your email.'}
        </p>
      </div>

      {failure ? <div className={styles.err}>{failure}</div> : null}

      <a className={styles.alt} href="/auth/coinpay/start">
        Continue with CoinPay
      </a>

      <button type="button" className={styles.alt} onClick={usePasskey} disabled={busy}>
        Use a passkey
      </button>

      <div className={styles.rule}>or</div>

      {sent ? (
        <div className={styles.ok}>
          If that address can receive mail, a link is on its way. It works once and expires in
          15 minutes.
        </div>
      ) : (
        <form className={styles.field} onSubmit={submitEmail}>
          <label className={styles.label} htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            name="email"
            required
            autoComplete="email webauthn"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className={styles.submit} type="submit" disabled={busy || !email}>
            {busy ? 'Sending…' : signup ? 'Send my sign-in link' : 'Email me a link'}
          </button>
        </form>
      )}

      <p className={styles.note}>
        No passwords. The emailed link proves the address, which is the whole account — so there
        is nothing to reset.
      </p>

      <p className={styles.foot}>
        {signup ? (
          <>
            Already here? <a href="/login">Sign in</a> — same thing, fewer words.
          </>
        ) : (
          <>
            First time? <a href="/signup">Create an account</a>.
          </>
        )}
      </p>
    </div>
  );
}
