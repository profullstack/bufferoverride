import { Hono } from 'hono';
import { db } from '@bufferoverride/db';
import { SESSION_COOKIE, actorFromSessionToken, readCookie } from '@bufferoverride/auth';
import { scanSecrets } from '@bufferoverride/core';
import { notify } from '@bufferoverride/notifications';

export const canonical = new Hono();

/**
 * Editing the canonical answer needs earned standing, because it speaks for
 * the question rather than for one person. Everything is revision-logged and
 * attributed, so the bar is about competence, not trust in a single account.
 */
const EDIT_REPUTATION = 100;

/**
 * Who may write it: anyone with earned standing, or whoever wrote the accepted
 * answer to *this* question.
 *
 * The second path exists because a flat reputation gate cannot bootstrap — on
 * a new corpus nobody clears the bar, so no canonical answer is ever written
 * and the reputation that would clear it is never earned. Having demonstrably
 * solved the question in front of you is its own evidence.
 */
async function editor(
  c: { req: { header(name: string): string | undefined } },
  questionId: number,
) {
  const actor = await actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
  if (!actor) return null;

  const r = await db().execute({
    sql: `select
            (select reputation from actors where id = ?) as reputation,
            (select count(*) from answers
              where question_id = ? and author_id = ? and is_accepted = 1) as solved`,
    args: [actor.id, questionId, actor.id],
  });
  const row = r.rows[0] as unknown as { reputation: number; solved: number };
  const reputation = Number(row?.reputation ?? 0);
  const solved = Number(row?.solved ?? 0) > 0;

  return { actor, reputation, solved, allowed: reputation >= EDIT_REPUTATION || solved };
}

canonical.get('/v1/questions/:id/canonical', async (c) => {
  const id = Number(c.req.param('id'));
  const r = await db().execute({
    sql: `select body, works_with, known_exceptions, state, updated_at
          from canonical_answers where question_id = ?`,
    args: [id],
  });
  if (!r.rows.length) return c.json({ data: null });

  const revisions = await db().execute({
    sql: `select rev.id, rev.comment, rev.created_at, a.username as actor
          from canonical_answer_revisions rev
          left join actors a on a.id = rev.actor_id
          where rev.question_id = ? order by rev.created_at desc`,
    args: [id],
  });

  return c.json({ data: { ...(r.rows[0] as object), revisions: revisions.rows } });
});

canonical.post('/v1/questions/:id/canonical', async (c) => {
  const questionId = Number(c.req.param('id'));
  const who = await editor(c, questionId);
  if (!who) return c.json({ error: 'unauthenticated' }, 401);
  if (!who.allowed)
    return c.json(
      {
        error: 'insufficient_reputation',
        need: EDIT_REPUTATION,
        have: who.reputation,
        message: `Needs ${EDIT_REPUTATION} reputation, or having written the accepted answer here.`,
      },
      403,
    );

  const exists = await db().execute({ sql: 'select id from questions where id = ?', args: [questionId] });
  if (!exists.rows.length) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json<{
    body?: string;
    worksWith?: string;
    knownExceptions?: string;
    comment?: string;
    sourceAnswerIds?: number[];
  }>();

  const text = (body.body ?? '').trim();
  if (text.length < 40)
    return c.json(
      { error: 'invalid', errors: [{ field: 'body', message: 'A canonical answer needs to stand on its own — at least a short paragraph.' }] },
      400,
    );

  const findings = scanSecrets(text);
  if (findings.length) return c.json({ error: 'secrets_detected', findings }, 409);

  // The revision is written first so the pointer can never reference a row
  // that does not exist; two transactions, which is the documented budget.
  const rev = await db().execute({
    sql: `insert into canonical_answer_revisions
            (question_id, actor_id, body, works_with, known_exceptions, comment)
          values (?, ?, ?, ?, ?, ?) returning id`,
    args: [
      questionId,
      who.actor.id,
      text,
      body.worksWith?.trim() || null,
      body.knownExceptions?.trim() || null,
      body.comment?.slice(0, 200) || null,
    ],
  });
  const revisionId = Number((rev.rows[0] as unknown as { id: number }).id);

  const statements: { sql: string; args: unknown[] }[] = [
    {
      sql: `insert into canonical_answers
              (question_id, body, works_with, known_exceptions, current_revision_id, state)
            values (?, ?, ?, ?, ?, 'published')
            on conflict (question_id) do update set
              body = excluded.body,
              works_with = excluded.works_with,
              known_exceptions = excluded.known_exceptions,
              current_revision_id = excluded.current_revision_id,
              state = 'published',
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      args: [questionId, text, body.worksWith?.trim() || null, body.knownExceptions?.trim() || null, revisionId],
    },
    {
      sql: `insert into audit_events (actor_id, action, target_type, target_id)
            values (?, 'canonical.revise', 'question', ?)`,
      args: [who.actor.id, String(questionId)],
    },
  ];

  for (const answerId of (body.sourceAnswerIds ?? []).slice(0, 20)) {
    statements.push({
      sql: `insert or ignore into canonical_answer_sources (question_id, answer_id)
            select ?, id from answers where id = ? and question_id = ?`,
      args: [questionId, Number(answerId), questionId],
    });
  }

  await db().batch(statements as never, 'write');
  return c.json({ data: { questionId, revisionId } }, 201);
});

canonical.post('/v1/questions/:id/canonical/challenge', async (c) => {
  const actor = await actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);

  const questionId = Number(c.req.param('id'));
  const body = await c.req.json<{ reason?: string }>();
  const reason = (body.reason ?? '').trim();
  if (reason.length < 15)
    return c.json(
      { error: 'invalid', errors: [{ field: 'reason', message: 'Say what is wrong with it, and ideally on which version.' }] },
      400,
    );

  const exists = await db().execute({
    sql: 'select question_id from canonical_answers where question_id = ?',
    args: [questionId],
  });
  if (!exists.rows.length) return c.json({ error: 'no_canonical_answer' }, 404);

  // A challenge marks the answer stale immediately. Being told it is wrong is
  // itself information a reader needs, before anyone has adjudicated.
  await db().batch(
    [
      {
        sql: 'insert into canonical_challenges (question_id, actor_id, reason) values (?, ?, ?)',
        args: [questionId, actor.id, reason.slice(0, 1000)],
      },
      {
        sql: `update canonical_answers set state = 'stale',
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              where question_id = ? and state = 'published'`,
        args: [questionId],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'canonical.challenge', 'question', ?)`,
        args: [actor.id, String(questionId)],
      },
    ] as never,
    'write',
  );

  const contributors = await db().execute({
    sql: `select distinct rev.actor_id, q.code, q.slug, q.title
          from canonical_answer_revisions rev
          join questions q on q.id = rev.question_id
          where rev.question_id = ?`,
    args: [questionId],
  });
  for (const row of contributors.rows as unknown as {
    actor_id: string;
    code: string;
    slug: string;
    title: string;
  }[]) {
    await notify({
      actorId: row.actor_id,
      type: 'canonical.challenged',
      title: `Canonical answer challenged: ${row.title}`,
      body: reason.slice(0, 200),
      url: `/q/${row.code}/${row.slug}/canonical`,
      fromActorId: actor.id,
    }).catch(() => {});
  }

  return c.json({ ok: true, state: 'stale' }, 201);
});
