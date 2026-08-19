import { Hono } from 'hono';
import { db } from '@bufferoverride/db';
import { SESSION_COOKIE, actorFromSessionToken, readCookie } from '@bufferoverride/auth';
import { canReviewFlags, PRIVILEGE } from '@bufferoverride/reputation';

export const moderation = new Hono();

/**
 * Moderation is a human privilege, earned.
 *
 * Session only — never an API key, so an agent credential can never act on
 * other people's content. The threshold is low on purpose: it exists to keep a
 * brand-new account from moderating, not to build a hierarchy.
 */
async function reviewer(c: { req: { header(name: string): string | undefined } }) {
  const actor = await actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
  if (!actor) return null;
  const r = await db().execute({ sql: 'select reputation from actors where id = ?', args: [actor.id] });
  const reputation = Number((r.rows[0] as unknown as { reputation: number })?.reputation ?? 0);
  return canReviewFlags(reputation) ? { actor, reputation } : { actor, reputation, denied: true as const };
}

moderation.get('/v1/flags', async (c) => {
  const who = await reviewer(c);
  if (!who) return c.json({ error: 'unauthenticated' }, 401);
  if ('denied' in who)
    return c.json({ error: 'insufficient_reputation', need: PRIVILEGE.flagReview, have: who.reputation }, 403);

  const r = await db().execute(`
    select f.id, f.content_type, f.content_id, f.reason, f.detail, f.created_at,
           a.username as reporter,
           case f.content_type
             when 'question' then (select title from questions where id = f.content_id)
             when 'answer'   then (select substr(body, 1, 180) from answers where id = f.content_id)
             else                 (select substr(body, 1, 180) from comments where id = f.content_id)
           end as excerpt,
           case f.content_type
             when 'question' then (select is_hidden from questions where id = f.content_id)
             when 'answer'   then (select is_hidden from answers where id = f.content_id)
             else 0
           end as is_hidden
    from flags f left join actors a on a.id = f.actor_id
    where f.state = 'open'
    order by f.created_at
    limit 100`);

  return c.json({ data: r.rows });
});

moderation.post('/v1/flags/:id/resolve', async (c) => {
  const who = await reviewer(c);
  if (!who) return c.json({ error: 'unauthenticated' }, 401);
  if ('denied' in who)
    return c.json({ error: 'insufficient_reputation', need: PRIVILEGE.flagReview, have: who.reputation }, 403);

  const flagId = Number(c.req.param('id'));
  const body = await c.req.json<{ action?: string; note?: string }>();
  const uphold = body.action === 'uphold';
  if (!uphold && body.action !== 'decline') return c.json({ error: 'invalid' }, 400);

  const f = await db().execute({
    sql: 'select content_type, content_id, actor_id from flags where id = ? and state = ?',
    args: [flagId, 'open'],
  });
  if (!f.rows.length) return c.json({ error: 'not_found' }, 404);
  const flag = f.rows[0] as unknown as { content_type: string; content_id: number; actor_id: string };

  // Reporting your own content and upholding it would be a way to hide things
  // you regret; the reviewer must not be the reporter.
  if (flag.actor_id === who.actor.id) return c.json({ error: 'cannot_review_own_flag' }, 403);

  const statements: { sql: string; args: unknown[] }[] = [
    {
      sql: `update flags set state = ?, resolved_by = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            where id = ?`,
      args: [uphold ? 'upheld' : 'declined', who.actor.id, flagId],
    },
  ];

  if (uphold && (flag.content_type === 'question' || flag.content_type === 'answer')) {
    const table = flag.content_type === 'question' ? 'questions' : 'answers';
    statements.push({ sql: `update ${table} set is_hidden = 1 where id = ?`, args: [flag.content_id] });
    statements.push({
      sql: `insert into moderation_actions (content_type, content_id, actor_id, action, reason, flag_id)
            values (?, ?, ?, 'hide', ?, ?)`,
      args: [flag.content_type, flag.content_id, who.actor.id, (body.note ?? '').slice(0, 300) || null, flagId],
    });
  }
  if (uphold && flag.content_type === 'comment') {
    statements.push({ sql: 'update comments set is_deleted = 1 where id = ?', args: [flag.content_id] });
  }

  statements.push({
    sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
          values (?, ?, ?, ?, ?)`,
    args: [
      who.actor.id,
      uphold ? 'flag.uphold' : 'flag.decline',
      flag.content_type,
      String(flag.content_id),
      JSON.stringify({ flagId }),
    ],
  });

  await db().batch(statements as never, 'write');
  return c.json({ ok: true, state: uphold ? 'upheld' : 'declined' });
});
