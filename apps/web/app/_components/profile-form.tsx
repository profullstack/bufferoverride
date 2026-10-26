'use client';

import { useState } from 'react';
import { ProfileFields } from '@profullstack/profile/react';
import styles from './auth.module.css';

type Values = Record<string, string | null>;

/**
 * The private signup profile, editable on /account: prefilled from the server,
 * saved with PATCH /api/v1/me/profile. Nothing here is shown on the public
 * profile page.
 */
export function ProfileForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setFailure(null);
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget).entries());
      const res = await fetch('/api/v1/me/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { profile?: Values; errors?: Record<string, string> };
      if (res.ok) {
        setErrors({});
        setValues(data.profile ?? (data as Values));
        setMessage('Saved.');
      } else {
        setErrors(data.errors ?? {});
        setFailure(data.errors ? 'A few of those fields need another look.' : 'Could not save. Try again.');
      }
    } catch {
      setFailure('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {message ? <div className={styles.ok}>{message}</div> : null}
      {failure ? <div className={styles.err}>{failure}</div> : null}
      {/* Keyed on the saved values so a save shows what the server normalized. */}
      <ProfileFields key={JSON.stringify(values)} defaultValues={values} errors={errors} idPrefix="account-" />
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? 'Saving…' : 'Save details'}
      </button>
    </form>
  );
}
