import { db } from '@bufferoverride/db';
import { canonicalOrigin } from './origin.ts';
import { findOrCreateByEmail, type Actor } from './actors.ts';
import { sendMagicLink } from './email.ts';
import { hashToken, isExpired, minutesFromNow, newToken } from './tokens.ts';

const LINK_MINUTES = 15;
const MAX_PER_HOUR = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value) && value.length <= 254;
}

/**
 * Issue a sign-in link.
 *
 * Always resolves the same way whether or not the address has an account, and
 * whether or not it was rate limited — the caller must report success either
 * way, otherwise this endpoint becomes a way to enumerate who has registered.
 */
export async function requestMagicLink(
  email: string,
  ip?: string,
  origin?: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!isEmail(normalized)) return;

  const recent = await db().execute({
    sql: `select count(*) as n from magic_links
          where email = ? and created_at > datetime('now', '-1 hour')`,
    args: [normalized],
  });
  if ((recent.rows[0] as unknown as { n: number }).n >= MAX_PER_HOUR) {
    console.warn(`[auth] magic link rate limit hit for ${normalized}`);
    return;
  }

  const token = newToken();
  await db().execute({
    sql: `insert into magic_links (email, token_hash, expires_at, requested_ip)
          values (?, ?, ?, ?)`,
    args: [normalized, hashToken(token), minutesFromNow(LINK_MINUTES), ip ?? null],
  });

  const base = origin ?? canonicalOrigin();
  await sendMagicLink(normalized, `${base}/auth/magic?token=${encodeURIComponent(token)}`);
}

/** Consume a link. Single use: the row is marked before the session is made. */
export async function consumeMagicLink(
  token: string,
): Promise<{ actor: Actor; created: boolean } | null> {
  const r = await db().execute({
    sql: `select id, email, expires_at, consumed_at from magic_links where token_hash = ?`,
    args: [hashToken(token)],
  });
  const row = r.rows[0] as unknown as
    | { id: number; email: string; expires_at: string; consumed_at: string | null }
    | undefined;

  if (!row || row.consumed_at || isExpired(row.expires_at)) return null;

  const claimed = await db().execute({
    sql: `update magic_links set consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          where id = ? and consumed_at is null`,
    args: [row.id],
  });
  // Lost the race against a concurrent use of the same link.
  if (claimed.rowsAffected === 0) return null;

  return findOrCreateByEmail(row.email);
}
