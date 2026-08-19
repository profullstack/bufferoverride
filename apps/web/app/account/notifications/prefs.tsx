'use client';

import { useState } from 'react';
import styles from '../settings.module.css';

type Pref = { type: string; label: string; email: boolean; web: boolean };

function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={on}
      aria-label={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onChange(!on);
        setBusy(false);
      }}
    />
  );
}

/** Saves on change — a settings page with a Save button people forget to press
 *  is a settings page that silently does nothing. */
export function NotificationPrefs({ initial }: { initial: Pref[] }) {
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function update(type: string, channel: 'email' | 'web', on: boolean) {
    setPrefs((prev) => prev.map((p) => (p.type === type ? { ...p, [channel]: on } : p)));
    setError(null);
    try {
      const res = await fetch('/v1/notification-preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, channel, on }),
      });
      if (!res.ok) throw new Error('rejected');
    } catch {
      // Put it back rather than showing a state the server does not hold.
      setPrefs((prev) => prev.map((p) => (p.type === type ? { ...p, [channel]: !on } : p)));
      setError('That change did not save.');
    }
  }

  return (
    <div className={styles.rows}>
      {error ? <div style={{ color: 'var(--status-danger)', fontSize: 13 }}>{error}</div> : null}
      <div className={styles.row} style={{ borderBottom: 0, paddingBottom: 0 }}>
        <span className={styles.rowHead} style={{ border: 0 }} />
        <span className={`${styles.rowHead} ${styles.toggleCell}`} style={{ border: 0 }}>
          EMAIL
        </span>
        <span className={`${styles.rowHead} ${styles.toggleCell}`} style={{ border: 0 }}>
          WEB
        </span>
      </div>
      {prefs.map((p) => (
        <div className={styles.row} key={p.type}>
          <span>{p.label}</span>
          <span className={styles.toggleCell}>
            <Toggle
              on={p.email}
              label={`${p.label} by email`}
              onChange={(next) => update(p.type, 'email', next)}
            />
          </span>
          <span className={styles.toggleCell}>
            <Toggle
              on={p.web}
              label={`${p.label} on the site`}
              onChange={(next) => update(p.type, 'web', next)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
