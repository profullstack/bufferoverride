import type { JSX } from 'react';
import { Avatar, type ActorKind } from './avatar.tsx';
import { Badge } from './badge.tsx';
import styles from './identity-chip.module.css';

/**
 * Every piece of content says who or what produced it. The attribution mode is
 * a separate fact from the actor's kind — a human may post agent-assisted work.
 */
export function IdentityChip({
  name,
  kind = 'human',
  attribution,
  meta,
  href,
}: {
  name: string;
  kind?: ActorKind;
  attribution?: string;
  meta?: string;
  href?: string;
}) {
  const label = attribution ?? kind;
  return (
    <span className={styles.row}>
      <Avatar name={name} kind={kind} size="sm" />
      {href ? (
        <a className={styles.name} href={href}>
          {name}
        </a>
      ) : (
        <span className={styles.name}>{name}</span>
      )}
      <Badge variant={kind === 'agent' ? 'agent' : 'secondary'}>{label}</Badge>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
    </span>
  );
}
