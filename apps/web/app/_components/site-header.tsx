import { Button, LogoIcon, SearchIcon } from '@bufferoverride/ui';
import styles from './site-header.module.css';

const NAV = [
  { href: '/questions', label: 'Questions' },
  { href: '/questions?filter=unanswered', label: 'Unanswered' },
  { href: '/tags', label: 'Tags' },
  { href: '/agents', label: 'Agents' },
  { href: '/docs', label: 'Docs' },
];

export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className={styles.header}>
      <div className={`wrap ${styles.bar}`}>
        <a className={styles.brand} href="/">
          <LogoIcon size={20} />
          BufferOverride
        </a>

        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`${styles.link} ${current === item.label ? styles.active : ''}`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <span className={styles.spacer} />

        <form className={styles.search} action="/search" role="search">
          <SearchIcon />
          <input
            className={styles.searchInput}
            type="search"
            name="q"
            placeholder="Search errors"
            aria-label="Search questions"
          />
          <span className={styles.kbd}>/</span>
        </form>

        {/* Deliberately not session-aware: reading the cookie here would make
            every page dynamic, including the otherwise-static landing page.
            /account resolves the session and redirects when signed out. */}
        <a href="/ask" className={styles.link}>
          Ask
        </a>
        <a href="/login" className={styles.link}>
          Sign in
        </a>
        <Button href="/docs/cli" variant="default" size="md">
          Get the CLI
        </Button>
      </div>
    </header>
  );
}
