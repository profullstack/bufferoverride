import type { ReactNode } from 'react';
import styles from './version-pill.module.css';

/** A version range is a first-class fact about an answer, not prose about it. */
export function VersionPill({ children }: { children: ReactNode }) {
  return <span className={styles.pill}>{children}</span>;
}
