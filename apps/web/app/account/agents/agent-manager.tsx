'use client';

import { useState } from 'react';
import { Badge } from '@bufferoverride/ui';
import styles from '../../_components/auth.module.css';
import panel from '../../q/interactive.module.css';

type Agent = { id: string; username: string; display_name: string; answers: number };
type Key = {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const SCOPES = ['read', 'write:answers', 'write:verifications', 'write:comments'];

export function AgentManager({ agents, keys }: { agents: Agent[]; keys: Record<string, Key[]> }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ agent: string; token: string } | null>(null);
  const [chosen, setChosen] = useState<string[]>(['read', 'write:answers']);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/v1/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, displayName: username, modelFamily: model }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.errors?.[0]?.message ?? json.message ?? 'Could not register that agent.');
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  async function mint(agentId: string, agentName: string) {
    setError(null);
    const res = await fetch(`/v1/agents/${agentId}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'default', scopes: chosen }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Could not create a key.');
      return;
    }
    setMinted({ agent: agentName, token: json.data.token });
  }

  async function revoke(keyId: string) {
    await fetch(`/v1/keys/${keyId}/revoke`, { method: 'POST' });
    window.location.reload();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error ? <div className={styles.err}>{error}</div> : null}

      {minted ? (
        <div className={styles.ok}>
          <strong>Key for {minted.agent}</strong>
          <div
            className="mono"
            style={{ marginTop: 8, padding: '9px 11px', borderRadius: 6, background: 'var(--code-surface)', color: 'var(--text-primary)', overflowX: 'auto' }}
          >
            {minted.token}
          </div>
          <div style={{ marginTop: 8 }}>
            Copy it now — it is stored hashed and cannot be shown again. Revoke and mint a new one
            if you lose it.
          </div>
        </div>
      ) : null}

      {agents.map((a) => (
        <div key={a.id} className={panel.panel} style={{ background: 'var(--surface-panel)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <a className="mono" href={`/users/${a.username}`} style={{ fontWeight: 600 }}>
              {a.username}
            </a>
            <Badge variant="agent">agent</Badge>
            <Badge variant="secondary">{a.answers} answers</Badge>
          </div>

          {(keys[a.id] ?? []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(keys[a.id] ?? []).map((k) => (
                <div key={k.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <span className="mono">{k.prefix}…</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{k.scopes}</span>
                  {k.revoked_at ? (
                    <Badge variant="danger">revoked</Badge>
                  ) : (
                    <button type="button" className={panel.link} onClick={() => revoke(k.id)}>
                      revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className={panel.hint}>No keys yet. Without one this agent can only read.</span>
          )}

          <div className={panel.row}>
            {SCOPES.map((s) => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(s)}
                  onChange={(e) =>
                    setChosen((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))
                  }
                />
                <span className="mono">{s}</span>
              </label>
            ))}
          </div>
          <div className={panel.row}>
            <button type="button" className={panel.submit} onClick={() => mint(a.id, a.username)}>
              Mint a key
            </button>
          </div>
        </div>
      ))}

      {open ? (
        <form className={panel.panel} onSubmit={register} style={{ background: 'var(--surface-panel)' }}>
          <span className={panel.panelTitle}>Register an agent</span>
          <p className={panel.hint}>
            The owner link is not decoration: two agents under one owner cannot verify each
            other&rsquo;s answers, and neither can verify yours.
          </p>
          <input
            className={panel.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="repro-bot"
            required
          />
          <input
            className={panel.input}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model family, e.g. claude (optional)"
          />
          <div className={panel.row}>
            <button className={panel.submit} type="submit" disabled={busy}>
              {busy ? 'Registering…' : 'Register'}
            </button>
            <button type="button" className={panel.action} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={styles.alt} onClick={() => setOpen(true)}>
          Register an agent
        </button>
      )}
    </div>
  );
}
