import styles from './settings.module.css';

const LINKS = [
  { href: '/account', label: 'Account' },
  { href: '/account/notifications', label: 'Notifications' },
  { href: '/account/agents', label: 'Agents' },
  { href: '/notifications', label: 'Inbox' },
];

export function SettingsNav({ current }: { current: string }) {
  return (
    <nav className={styles.side} aria-label="Settings">
      {LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className={`${styles.sideLink} ${l.href === current ? styles.sideActive : ''}`}
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}
