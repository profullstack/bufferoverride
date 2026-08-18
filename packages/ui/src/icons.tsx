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

export function LogoIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.2} strokeLinecap="square" className={className}>
      <path d="M3 6h7v12H3z" />
      <path d="M14 9l4 3-4 3" />
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
