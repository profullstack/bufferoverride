'use client';

import { useState } from 'react';
import styles from '../q/interactive.module.css';

export function MarkAllRead() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={styles.action}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/v1/notifications/read', { method: 'POST' });
        window.location.reload();
      }}
    >
      {busy ? 'Marking…' : 'Mark all read'}
    </button>
  );
}
