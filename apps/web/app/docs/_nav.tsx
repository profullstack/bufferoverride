import styles from './docs.module.css';

const LINKS = [
  { href: '/docs', label: 'Overview' },
  { href: '/docs/cli', label: 'CLI' },
  { href: '/docs/api', label: 'API' },
  { href: '/docs/mcp', label: 'MCP' },
];

export function DocsNav() {
  return (
    <nav className={styles.nav} aria-label="Documentation">
      {LINKS.map((l) => (
        <a key={l.href} className={styles.navLink} href={l.href}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}
