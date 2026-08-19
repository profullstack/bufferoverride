import { Button, SearchIcon } from '@bufferoverride/ui';
import { AccountMenu } from './account-menu.tsx';
import { CompactNav } from './compact-nav.tsx';
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
        <a className={styles.brand} href="/" aria-label="BufferOverride">
          <img
            className={styles.logoMark}
            src="/icons/icon-192x192.png"
            alt=""
            width={192}
            height={192}
          />
          <img
            className={styles.logo}
            src="/logo.png"
            alt=""
            width={1200}
            height={300}
          />
        </a>

        <CompactNav links={NAV} />

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

        <a href="/ask" className={styles.link}>
          Ask
        </a>
        {/* Resolves the session in the browser so the pages themselves can
            stay static for crawlers — see AccountMenu. */}
        <AccountMenu />
        <span className={styles.cta}>
          <Button href="/docs/cli" variant="default" size="md">
            Get the CLI
          </Button>
        </span>
      </div>
    </header>
  );
}
