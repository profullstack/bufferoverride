'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './account-menu.module.css';
import header from './site-header.module.css';

/**
 * Navigation for widths where the inline nav does not fit.
 *
 * Without this the site had no navigation at all below 1024px — the links were
 * simply hidden and nothing replaced them, so a phone could reach only
 * whatever was already on screen.
 */
export function CompactNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

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

  return (
    <div className={`${styles.wrap} ${header.compact}`} ref={wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open ? (
        <div className={styles.menu} style={{ right: 'auto', left: 0 }} role="menu">
          <form action="/search" role="search" style={{ padding: '4px 6px 8px' }}>
            <input
              className={header.searchInput}
              type="search"
              name="q"
              placeholder="Search errors"
              aria-label="Search questions"
              style={{
                width: '100%',
                height: 34,
                padding: '0 10px',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-control)',
              }}
            />
          </form>
          <div className={styles.sep} />
          {links.map((l) => (
            <a key={l.href} className={styles.item} href={l.href} role="menuitem">
              {l.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
