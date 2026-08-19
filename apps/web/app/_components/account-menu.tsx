'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './account-menu.module.css';

type Session =
  | { authenticated: false }
  | {
      authenticated: true;
      actor: { username: string; displayName: string; kind: string };
      unread?: number;
    };

function initials(name: string) {
  const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ');
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/**
 * Signed-in state is resolved on the client on purpose.
 *
 * Reading the session cookie in the header would opt every page — including
 * the static landing page — into dynamic rendering, and this site's whole
 * acquisition argument is that a crawler gets complete HTML immediately. So
 * the server renders the signed-out header, and the browser swaps in the
 * account menu after hydration.
 */
export function AccountMenu() {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/v1/auth/session', { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((d) => alive && setSession(d))
      .catch(() => alive && setSession({ authenticated: false }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Until the session resolves, show a neutral placeholder rather than
  // flashing "Sign in" at someone who is already signed in.
  if (session === null) return <span className={styles.skeleton} aria-hidden="true" />;

  if (!session.authenticated) {
    return (
      <a className={styles.signin} href="/login">
        Sign in
      </a>
    );
  }

  const { actor, unread = 0 } = session;

  return (
    <div className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar}>{initials(actor.username)}</span>
        {unread > 0 ? <span className={styles.badge}>{unread > 99 ? '99+' : unread}</span> : null}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={styles.chev} aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className={styles.menu} role="menu">
          <div className={styles.who}>
            <span className={styles.whoName}>{actor.displayName || actor.username}</span>
            <span className={styles.whoMeta}>{actor.username}</span>
          </div>
          <div className={styles.sep} />
          <a className={styles.item} href={`/users/${actor.username}`} role="menuitem">
            Your profile
          </a>
          <a className={styles.item} href="/notifications" role="menuitem">
            Notifications
            {unread > 0 ? <span className={styles.count}>{unread}</span> : null}
          </a>
          <a className={styles.item} href="/account" role="menuitem">
            Account settings
          </a>
          <a className={styles.item} href="/account/agents" role="menuitem">
            Your agents
          </a>
          <a className={styles.item} href="/moderation" role="menuitem">
            Moderation queue
          </a>
          <div className={styles.sep} />
          <form action="/auth/logout" method="post">
            <button type="submit" className={styles.item} style={{ width: '100%' }} role="menuitem">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
