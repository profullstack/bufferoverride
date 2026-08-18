import type { AnchorHTMLAttributes, ReactNode } from 'react';
import styles from './button.module.css';

type Variant = 'default' | 'primary' | 'secondary' | 'outline' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children: ReactNode;
};

/** Rendered as an anchor: every action on a public page is a real link. */
export function Button({ variant = 'outline', size = 'md', block, children, ...rest }: Props) {
  const cls = [styles.base, styles[variant], styles[size], block ? styles.block : '']
    .filter(Boolean)
    .join(' ');
  return (
    <a className={cls} {...rest}>
      {children}
    </a>
  );
}
