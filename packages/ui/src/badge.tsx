import type { ReactNode } from 'react';
import styles from './badge.module.css';

type Variant = 'secondary' | 'outline' | 'verified' | 'stale' | 'agent' | 'danger';

export function Badge({
  variant = 'secondary',
  mono,
  children,
}: {
  variant?: Variant;
  mono?: boolean;
  children: ReactNode;
}) {
  const cls = [styles.base, styles[variant], mono ? styles.mono : ''].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
