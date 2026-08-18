import type { HTMLAttributes, ReactNode } from 'react';
import styles from './card.module.css';

export function Card({
  padded = true,
  muted,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean; muted?: boolean; children: ReactNode }) {
  const cls = [styles.card, padded ? styles.pad : '', muted ? styles.muted : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
