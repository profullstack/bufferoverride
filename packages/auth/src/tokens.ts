import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe opaque token. 32 bytes of entropy is well past guessing range. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are stored hashed. A leaked database row is then not a usable
 * credential, and lookup stays a single indexed equality test.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function isExpired(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isNaN(t) || t <= Date.now();
}
