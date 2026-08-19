'use client';

import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import styles from './auth.module.css';

/** Passkeys are added after the fact and become the fast way back in. */
export function PasskeyManager({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function addPasskey() {
    setBusy(true);
    setMessage(null);
    setFailure(null);
    try {
      const optionsRes = await fetch('/auth/passkey/register/options', { method: 'POST' });
      if (!optionsRes.ok) throw new Error('options');
      const options = await optionsRes.json();
      const response = await startRegistration({ optionsJSON: options });
      const verify = await fetch('/auth/passkey/register/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response, label: navigator.userAgent.slice(0, 60) }),
      });
      if (!verify.ok) throw new Error('verify');
      setMessage('Passkey added. It will work on your next sign-in.');
    } catch {
      setFailure('That passkey could not be registered on this device.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {message ? <div className={styles.ok}>{message}</div> : null}
      {failure ? <div className={styles.err}>{failure}</div> : null}
      <button type="button" className={styles.alt} onClick={addPasskey} disabled={busy}>
        {busy ? 'Waiting for your device…' : count > 0 ? 'Add another passkey' : 'Add a passkey'}
      </button>
    </div>
  );
}
