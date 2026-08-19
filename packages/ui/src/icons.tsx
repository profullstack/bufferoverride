import type { JSX } from 'react';
type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/**
 * The mark: three rows in a bounded buffer, the middle one running past the
 * wall. The overflowing row keeps the accent; everything else inherits
 * currentColor so the mark themes with whatever it sits on.
 */
export function LogoIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M20 5H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h13"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <path d="M10 11h6" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M10 21h6" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M10 16h17" stroke="var(--accent-primary)" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={3} className={className}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function SearchIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function ClockIcon({ size = 11, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.4} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
    </svg>
  );
}

export function ArrowUpIcon({ size = 13, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.2} className={className}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
