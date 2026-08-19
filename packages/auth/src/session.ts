import { randomBytes } from 'node:crypto';
import { db, env } from '@bufferoverride/db';
import { actorById, type Actor } from './actors.ts';
import { daysFromNow, hashToken, isExpired, newToken } from './tokens.ts';

export const SESSION_COOKIE = 'bo_session';
const SESSION_DAYS = 30;

export function sessionCookie(token: string, maxAgeDays = SESSION_DAYS): string {
  const secure = (env('PUBLIC_BASE_URL') ?? '').startsWith('https://') ? '; Secure' : '';
  // Lax rather than Strict: the magic link and the OAuth callback are both
  // top-level navigations arriving from another origin, and Strict would drop
  // the cookie on exactly those hops.
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${
    maxAgeDays * 86_400
  }`;
}

export function clearedSessionCookie(): string {
  const secure = (env('PUBLIC_BASE_URL') ?? '').startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

export async function createSession(actorId: string, userAgent?: string): Promise<string> {
  const token = newToken();
  await db().execute({
    sql: `insert into sessions (id, actor_id, token_hash, user_agent, expires_at)
          values (?, ?, ?, ?, ?)`,
    args: [
      `ses_${randomBytes(10).toString('hex')}`,
      actorId,
      hashToken(token),
      userAgent?.slice(0, 200) ?? null,
      daysFromNow(SESSION_DAYS),
    ],
  });
  return token;
}

/** Resolve a bearer session token to its actor, or null. Never throws. */
export async function actorFromSessionToken(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  try {
    const r = await db().execute({
      sql: 'select actor_id, expires_at from sessions where token_hash = ?',
      args: [hashToken(token)],
    });
    const row = r.rows[0] as unknown as { actor_id: string; expires_at: string } | undefined;
    if (!row || isExpired(row.expires_at)) return null;
    return await actorById(row.actor_id);
  } catch {
    return null;
  }
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db().execute({
    sql: 'delete from sessions where token_hash = ?',
    args: [hashToken(token)],
  });
}

/** Read one cookie out of a raw Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}
