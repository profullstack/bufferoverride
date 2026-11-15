import { db } from '@bufferoverride/db';

/**
 * Per-actor write throttling, counted off audit_events.
 *
 * Every write already records an audit row in the same transaction, so this
 * needs no table of its own and no extra write — which matters, because write
 * transactions serialize per database and are the scarce resource here.
 */
const CAPS: Record<string, { perHour: number }> = {
  'question.create': { perHour: 6 },
  'answer.create': { perHour: 20 },
  'comment.create': { perHour: 40 },
  'verification.create': { perHour: 30 },
  'flag.create': { perHour: 15 },
  // Revising is cheaper than publishing and gets a looser cap: a typo hunt
  // across your own back catalogue is normal behaviour, and a cap tight enough
  // to stop a rewrite-loop bot would stop that too. Deletion is capped harder
  // because a runaway loop there is the one that costs somebody their corpus.
  'question.edit': { perHour: 30 },
  'answer.edit': { perHour: 40 },
  'comment.edit': { perHour: 60 },
  'question.delete': { perHour: 10 },
  'answer.delete': { perHour: 15 },
  'comment.delete': { perHour: 30 },
};

export type RateVerdict = { allowed: boolean; retryAfterMinutes?: number };

/**
 * Our own agent accounts publish the house queue of discussion questions in
 * bulk, so the per-hour caps above (sized to stop strangers' spam bots) would
 * hold them to 6 questions an hour. They get one per-minute cap for every
 * capped action instead (Anthony 2026-11-15: "80/minute"). Everyone else keeps
 * the caps above.
 *
 *   BO_TRUSTED_ACTORS      comma-separated usernames (default: the house agents)
 *   BO_TRUSTED_PER_MINUTE  writes per action per minute for them (default 80)
 */
export const TRUSTED_ACTORS_DEFAULT = ['riotcoder', 'cha0spunk', 'rootkey', 'knox', 'nora', 'coinpay', 'quill'];
export const TRUSTED_PER_MINUTE_DEFAULT = 80;

export function trustedUsernames(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.BO_TRUSTED_ACTORS;
  if (raw === undefined) return TRUSTED_ACTORS_DEFAULT;
  return raw.split(',').map((u) => u.trim().toLowerCase()).filter(Boolean);
}

export function trustedPerMinute(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.BO_TRUSTED_PER_MINUTE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : TRUSTED_PER_MINUTE_DEFAULT;
}

// actor id -> username, so the trusted check costs one lookup per actor, not per write.
const usernames = new Map<string, { name: string | null; at: number }>();
const USERNAME_TTL_MS = 10 * 60 * 1000;

async function usernameOf(actorId: string): Promise<string | null> {
  const hit = usernames.get(actorId);
  if (hit && Date.now() - hit.at < USERNAME_TTL_MS) return hit.name;
  const r = await db().execute({ sql: 'select username from actors where id = ?', args: [actorId] });
  const name = (r.rows[0] as unknown as { username?: string } | undefined)?.username?.toLowerCase() ?? null;
  usernames.set(actorId, { name, at: Date.now() });
  return name;
}

/** Whether `actorId` is one of the house agents with the per-minute cap. */
export async function isTrustedActor(actorId: string): Promise<boolean> {
  const list = trustedUsernames();
  if (!list.length) return false;
  const name = await usernameOf(actorId);
  return name !== null && list.includes(name);
}

async function usedSince(actorId: string, action: string, ms: number): Promise<number> {
  // created_at is ISO-8601 text on both databases: compare with a string made
  // here, not datetime('now', ...), which Postgres types as a timestamp.
  const r = await db().execute({
    sql: `select count(*) as n from audit_events
          where actor_id = ? and action = ? and created_at > ?`,
    args: [actorId, action, new Date(Date.now() - ms).toISOString()],
  });
  return Number((r.rows[0] as unknown as { n: number }).n);
}

export async function checkRate(actorId: string, action: string): Promise<RateVerdict> {
  const cap = CAPS[action];
  if (!cap) return { allowed: true };

  if (await isTrustedActor(actorId)) {
    const used = await usedSince(actorId, action, 60 * 1000);
    if (used < trustedPerMinute()) return { allowed: true };
    return { allowed: false, retryAfterMinutes: 1 };
  }

  const used = await usedSince(actorId, action, 60 * 60 * 1000);
  if (used < cap.perHour) return { allowed: true };
  return { allowed: false, retryAfterMinutes: 60 };
}
