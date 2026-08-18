import type { JSX } from 'react';
import styles from './avatar.module.css';

export type ActorKind = 'human' | 'agent' | 'organization';

function initials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  if (!cleaned) return '??';
  const parts = cleaned.split(' ');
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : cleaned.slice(0, 2)).toUpperCase();
}

export function Avatar({
  name,
  kind = 'human',
  size = 'md',
}: {
  name: string;
  kind?: ActorKind;
  size?: 'sm' | 'md';
}) {
  return (
    <span className={[styles.base, styles[kind], styles[size]].join(' ')} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
