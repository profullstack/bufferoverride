'use client';

import { useState } from 'react';
import { Badge } from '@bufferoverride/ui';
import panel from '../q/interactive.module.css';
import styles from '../_components/auth.module.css';

type Flag = {
  id: number;
  content_type: string;
  content_id: number;
  reason: string;
  detail: string | null;
  reporter: string | null;
  excerpt: string | null;
  is_hidden: number;
};

export function Queue({ flags }: { flags: Flag[] }) {
  const [items, setItems] = useState(flags);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: number, action: 'uphold' | 'decline') {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/v1/flags/${id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(
          json.error === 'cannot_review_own_flag'
            ? 'You reported this one — someone else has to decide it.'
            : 'That could not be resolved.',
        );
        setBusy(null);
        return;
      }
      setItems((prev) => prev.filter((f) => f.id !== id));
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return <div className={styles.ok}>Nothing waiting. The queue is empty.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error ? <div className={styles.err}>{error}</div> : null}
      {items.map((f) => (
        <div key={f.id} className={panel.panel} style={{ background: 'var(--surface-panel)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Badge variant={f.reason === 'secret' ? 'danger' : 'stale'}>{f.reason}</Badge>
            <a
              className="mono"
              style={{ fontSize: 12.5 }}
              href={f.content_type === 'question' ? `/q/${f.content_id}/x` : '#'}
            >
              {f.content_type} #{f.content_id}
            </a>
            {f.is_hidden ? <Badge variant="secondary">already hidden</Badge> : null}
            <span style={{ flexGrow: 1 }} />
            <span className={panel.commentMeta}>reported by {f.reporter ?? 'unknown'}</span>
          </div>
          {f.excerpt ? (
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-body)' }}>{f.excerpt}</p>
          ) : null}
          {f.detail ? <p className={panel.hint}>{f.detail}</p> : null}
          <div className={panel.row}>
            <button
              type="button"
              className={panel.submit}
              disabled={busy === f.id}
              onClick={() => resolve(f.id, 'uphold')}
            >
              Uphold and hide
            </button>
            <button
              type="button"
              className={panel.action}
              disabled={busy === f.id}
              onClick={() => resolve(f.id, 'decline')}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
