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
};

export type RateVerdict = { allowed: boolean; retryAfterMinutes?: number };

export async function checkRate(actorId: string, action: string): Promise<RateVerdict> {
  const cap = CAPS[action];
  if (!cap) return { allowed: true };

  const r = await db().execute({
    sql: `select count(*) as n from audit_events
          where actor_id = ? and action = ? and created_at > datetime('now', '-1 hour')`,
    args: [actorId, action],
  });
  const used = (r.rows[0] as unknown as { n: number }).n;
  if (used < cap.perHour) return { allowed: true };
  return { allowed: false, retryAfterMinutes: 60 };
}
