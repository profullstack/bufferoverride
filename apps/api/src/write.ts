import { Hono } from 'hono';
import { db } from '@bufferoverride/db';
import {
  SESSION_COOKIE,
  actorFromSessionToken,
  areIndependent,
  principalFromAuthHeader,
  readCookie,
  type Actor,
  type Scope,
} from '@bufferoverride/auth';
import {
  checkRate,
  findDuplicates,
  normalizeTag,
  scanSecrets,
  slugify,
  validateAnswer,
  validateComment,
  validateQuestion,
} from '@bufferoverride/core';

export const write = new Hono();

type Principal = { actor: Actor; viaKey: boolean };

/**
 * Two ways to act: a browser session, or a scoped API key.
 *
 * A session carries the full set of a human's own abilities. A key carries
 * only what it was granted, so an agent credential that can answer cannot
 * silently start voting or flagging. Content can never widen its own scope —
 * the grant is fixed at key creation and checked here, never read from input.
 */
async function principalFor(
  c: { req: { header(name: string): string | undefined } },
  scope: Scope,
): Promise<Principal | 'forbidden' | null> {
  const key = await principalFromAuthHeader(c.req.header('authorization'));
  if (key) {
    if (!key.scopes.includes(scope)) return 'forbidden';
    return { actor: key.actor, viaKey: true };
  }
  const actor = await actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
  return actor ? { actor, viaKey: false } : null;
}

function deny(p: 'forbidden' | null) {
  return p === 'forbidden'
    ? ({ error: 'insufficient_scope' } as const)
    : ({ error: 'unauthenticated' } as const);
}

/**
 * Writes accept JSON only.
 *
 * The session cookie is SameSite=Lax, so it is not sent on a cross-site POST
 * at all; requiring a JSON content type closes the remaining gap, because a
 * plain cross-origin <form> can only send the three simple content types and
 * therefore cannot reach any of these handlers.
 */
function wantsJson(c: { req: { header(name: string): string | undefined } }): boolean {
  return (c.req.header('content-type') ?? '').includes('application/json');
}

// ── search before ask ─────────────────────────────────────────────────────
write.post('/v1/questions/duplicates', async (c) => {
  const body = await c.req.json<{ title?: string }>().catch(() => ({}));
  const hits = await findDuplicates((body.title ?? '').trim());
  return c.json({ data: hits });
});

// ── secret preview ────────────────────────────────────────────────────────
write.post('/v1/scan', async (c) => {
  const body = await c.req.json<{ text?: string }>().catch(() => ({}));
  return c.json({ findings: scanSecrets(body.text ?? '') });
});

// ── ask ───────────────────────────────────────────────────────────────────
write.post('/v1/questions', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const principal = await principalFor(c, 'write:questions');
  if (!principal || principal === 'forbidden')
    return c.json(deny(principal), principal === 'forbidden' ? 403 : 401);
  const { actor } = principal;

  const rate = await checkRate(actor.id, 'question.create');
  if (!rate.allowed) return c.json({ error: 'rate_limited', retryAfterMinutes: 60 }, 429);

  const body = await c.req.json<{
    title?: string;
    body?: string;
    tags?: string[];
    attribution?: string;
    acknowledgeSecrets?: boolean;
  }>();

  const title = (body.title ?? '').trim();
  const text = (body.body ?? '').trim();
  const tags = [...new Set((body.tags ?? []).map(normalizeTag).filter((t): t is string => !!t))].slice(0, 5);

  const errors = validateQuestion({ title, body: text, tags });
  if (errors.length) return c.json({ error: 'invalid', errors }, 400);

  // The author must see what was found and say so explicitly; nothing is
  // silently redacted on their behalf.
  const findings = scanSecrets(`${title}\n${text}`);
  if (findings.length && !body.acknowledgeSecrets) {
    return c.json({ error: 'secrets_detected', findings }, 409);
  }

  const attribution = ['human', 'agent', 'human-assisted-agent', 'agent-assisted-human', 'organization']
    .includes(body.attribution ?? '')
    ? body.attribution
    : 'human';

  // Two write transactions, which is the documented budget: the insert has to
  // return the id before the rows that reference it can be written.
  const inserted = await db().execute({
    sql: `insert into questions (slug, title, body, author_id, attribution)
          values (?, ?, ?, ?, ?) returning id`,
    args: [slugify(title), title, text, actor.id, attribution as string],
  });
  const id = Number((inserted.rows[0] as unknown as { id: number }).id);

  const statements: { sql: string; args: unknown[] }[] = [
    {
      sql: `insert into revisions (content_type, content_id, actor_id, body, comment)
            values ('question', ?, ?, ?, 'created')`,
      args: [id, actor.id, text],
    },
  ];
  for (const tag of tags) {
    statements.push({ sql: 'insert or ignore into tags (slug, name) values (?, ?)', args: [tag, tag] });
    statements.push({
      sql: `insert or ignore into question_tags (question_id, tag_id)
            select ?, id from tags where slug = ?`,
      args: [id, tag],
    });
  }
  statements.push({
    sql: `insert into audit_events (actor_id, action, target_type, target_id)
          values (?, 'question.create', 'question', ?)`,
    args: [actor.id, String(id)],
  });
  await db().batch(statements as never, 'write');

  return c.json({ data: { id, slug: slugify(title), url: `/q/${id}/${slugify(title)}` } }, 201);
});

// ── answer ────────────────────────────────────────────────────────────────
write.post('/v1/questions/:id/answers', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const principal = await principalFor(c, 'write:answers');
  if (!principal || principal === 'forbidden')
    return c.json(deny(principal), principal === 'forbidden' ? 403 : 401);
  const { actor } = principal;

  const questionId = Number(c.req.param('id'));
  const exists = await db().execute({ sql: 'select id from questions where id = ?', args: [questionId] });
  if (!exists.rows.length) return c.json({ error: 'not_found' }, 404);

  const rate = await checkRate(actor.id, 'answer.create');
  if (!rate.allowed) return c.json({ error: 'rate_limited', retryAfterMinutes: 60 }, 429);

  const body = await c.req.json<{
    body?: string;
    validFrom?: string;
    validThrough?: string;
    attribution?: string;
    acknowledgeSecrets?: boolean;
  }>();
  const text = (body.body ?? '').trim();

  const errors = validateAnswer(text);
  if (errors.length) return c.json({ error: 'invalid', errors }, 400);

  const findings = scanSecrets(text);
  if (findings.length && !body.acknowledgeSecrets) {
    return c.json({ error: 'secrets_detected', findings }, 409);
  }

  const attribution = ['human', 'agent', 'human-assisted-agent', 'agent-assisted-human', 'organization']
    .includes(body.attribution ?? '')
    ? body.attribution
    : 'human';

  const inserted = await db().execute({
    sql: `insert into answers (question_id, author_id, attribution, body, valid_from, valid_through)
          values (?, ?, ?, ?, ?, ?) returning id`,
    args: [
      questionId,
      actor.id,
      attribution as string,
      text,
      body.validFrom?.trim() || null,
      body.validThrough?.trim() || null,
    ],
  });
  const id = Number((inserted.rows[0] as unknown as { id: number }).id);

  await db().batch(
    [
      {
        sql: `insert into revisions (content_type, content_id, actor_id, body, comment)
              values ('answer', ?, ?, ?, 'created')`,
        args: [id, actor.id, text],
      },
      {
        sql: `update questions
              set answer_count = (select count(*) from answers where question_id = ?),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              where id = ?`,
        args: [questionId, questionId],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'answer.create', 'answer', ?)`,
        args: [actor.id, String(id)],
      },
    ] as never,
    'write',
  );

  return c.json({ data: { id, anchor: `#answer-${id}` } }, 201);
});

// ── verify ────────────────────────────────────────────────────────────────
write.post('/v1/answers/:id/verify', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const principal = await principalFor(c, 'write:verifications');
  if (!principal || principal === 'forbidden')
    return c.json(deny(principal), principal === 'forbidden' ? 403 : 401);
  const { actor } = principal;

  const answerId = Number(c.req.param('id'));
  const answer = await db().execute({
    sql: 'select id, author_id from answers where id = ?',
    args: [answerId],
  });
  if (!answer.rows.length) return c.json({ error: 'not_found' }, 404);
  const authorId = (answer.rows[0] as unknown as { author_id: string }).author_id;

  const rate = await checkRate(actor.id, 'verification.create');
  if (!rate.allowed) return c.json({ error: 'rate_limited', retryAfterMinutes: 60 }, 429);

  const body = await c.req.json<{ result?: string; environment?: string; method?: string; notes?: string }>();
  const result = ['pass', 'fail', 'partial'].includes(body.result ?? '') ? body.result! : null;
  if (!result) return c.json({ error: 'invalid', errors: [{ field: 'result', message: 'pass, fail or partial.' }] }, 400);

  const environment = (body.environment ?? '').trim();
  if (environment.length < 3) {
    return c.json(
      { error: 'invalid', errors: [{ field: 'environment', message: 'Say what you ran it on — a verification without an environment proves nothing.' }] },
      400,
    );
  }

  // Independence is computed, never claimed — and it is not just "a different
  // account": two agents under one owner, or an owner and their own agent,
  // cannot vouch for each other. The run is still recorded and shown; it just
  // does not count.
  const independent = (await areIndependent(actor.id, authorId)) ? 1 : 0;

  await db().batch(
    [
      {
        sql: `insert into verifications (answer_id, actor_id, result, method, environment, output_summary, is_independent)
              values (?, ?, ?, ?, ?, ?, ?)`,
        args: [answerId, actor.id, result, body.method ?? 'manual', environment, (body.notes ?? '').slice(0, 2000) || null, independent],
      },
      {
        sql: `update answers set verified_count = (
                select count(*) from verifications
                where answer_id = ? and result = 'pass' and is_independent = 1
              ) where id = ?`,
        args: [answerId, answerId],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'verification.create', 'answer', ?)`,
        args: [actor.id, String(answerId)],
      },
    ] as never,
    'write',
  );

  return c.json({ data: { answerId, result, independent: independent === 1 } }, 201);
});

// ── accept ────────────────────────────────────────────────────────────────
write.post('/v1/answers/:id/accept', async (c) => {
  const principal = await principalFor(c, 'write:questions');
  if (!principal || principal === 'forbidden')
    return c.json(deny(principal), principal === 'forbidden' ? 403 : 401);
  const { actor } = principal;

  const answerId = Number(c.req.param('id'));
  const r = await db().execute({
    sql: `select ans.id, ans.question_id, q.author_id as asker
          from answers ans join questions q on q.id = ans.question_id where ans.id = ?`,
    args: [answerId],
  });
  if (!r.rows.length) return c.json({ error: 'not_found' }, 404);
  const row = r.rows[0] as unknown as { question_id: number; asker: string };
  if (row.asker !== actor.id) return c.json({ error: 'not_the_asker' }, 403);

  await db().batch(
    [
      { sql: 'update answers set is_accepted = 0 where question_id = ?', args: [row.question_id] },
      { sql: 'update answers set is_accepted = 1 where id = ?', args: [answerId] },
      {
        sql: `update questions set accepted_answer_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = ?`,
        args: [answerId, row.question_id],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'answer.accept', 'answer', ?)`,
        args: [actor.id, String(answerId)],
      },
    ] as never,
    'write',
  );
  return c.json({ data: { accepted: answerId } });
});

// ── vote ──────────────────────────────────────────────────────────────────
write.post('/v1/votes', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  // Voting is a human judgement and is not offered to key-based callers at all.
  const actor = await actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);

  const body = await c.req.json<{ contentType?: string; contentId?: number; value?: number }>();
  const contentType = body.contentType === 'answer' ? 'answer' : body.contentType === 'question' ? 'question' : null;
  const contentId = Number(body.contentId);
  const value = Number(body.value);
  if (!contentType || !Number.isInteger(contentId) || ![1, -1, 0].includes(value)) {
    return c.json({ error: 'invalid' }, 400);
  }

  const table = contentType === 'answer' ? 'answers' : 'questions';
  const owner = await db().execute({
    sql: `select author_id from ${table} where id = ?`,
    args: [contentId],
  });
  if (!owner.rows.length) return c.json({ error: 'not_found' }, 404);
  // Self-voting is not a moderation problem to catch later; it just is not a vote.
  if ((owner.rows[0] as unknown as { author_id: string }).author_id === actor.id) {
    return c.json({ error: 'cannot_vote_on_own_content' }, 403);
  }

  const statements =
    value === 0
      ? [
          {
            sql: 'delete from votes where actor_id = ? and content_type = ? and content_id = ?',
            args: [actor.id, contentType, contentId],
          },
        ]
      : [
          {
            sql: `insert into votes (actor_id, content_type, content_id, value) values (?, ?, ?, ?)
                  on conflict (actor_id, content_type, content_id) do update set value = excluded.value`,
            args: [actor.id, contentType, contentId, value],
          },
        ];
  statements.push({
    sql: `update ${table} set score = (
            select coalesce(sum(value), 0) from votes where content_type = ? and content_id = ?
          ) where id = ?`,
    args: [contentType, contentId, contentId],
  });

  await db().batch(statements as never, 'write');

  const score = await db().execute({ sql: `select score from ${table} where id = ?`, args: [contentId] });
  return c.json({ data: { score: (score.rows[0] as unknown as { score: number }).score } });
});

// ── comment ───────────────────────────────────────────────────────────────
write.post('/v1/comments', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const principal = await principalFor(c, 'write:comments');
  if (!principal || principal === 'forbidden')
    return c.json(deny(principal), principal === 'forbidden' ? 403 : 401);
  const { actor } = principal;

  const rate = await checkRate(actor.id, 'comment.create');
  if (!rate.allowed) return c.json({ error: 'rate_limited', retryAfterMinutes: 60 }, 429);

  const body = await c.req.json<{ contentType?: string; contentId?: number; body?: string }>();
  const contentType = body.contentType === 'answer' ? 'answer' : body.contentType === 'question' ? 'question' : null;
  const contentId = Number(body.contentId);
  const text = (body.body ?? '').trim();
  if (!contentType || !Number.isInteger(contentId)) return c.json({ error: 'invalid' }, 400);

  const errors = validateComment(text);
  if (errors.length) return c.json({ error: 'invalid', errors }, 400);

  const findings = scanSecrets(text);
  if (findings.length) return c.json({ error: 'secrets_detected', findings }, 409);

  await db().batch(
    [
      {
        sql: `insert into comments (content_type, content_id, author_id, body) values (?, ?, ?, ?)`,
        args: [contentType, contentId, actor.id, text],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'comment.create', ?, ?)`,
        args: [actor.id, contentType, String(contentId)],
      },
    ] as never,
    'write',
  );
  return c.json({ ok: true }, 201);
});

// ── flag ──────────────────────────────────────────────────────────────────
write.post('/v1/flags', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const actor = await actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);

  const rate = await checkRate(actor.id, 'flag.create');
  if (!rate.allowed) return c.json({ error: 'rate_limited', retryAfterMinutes: 60 }, 429);

  const body = await c.req.json<{ contentType?: string; contentId?: number; reason?: string; detail?: string }>();
  const contentType = ['question', 'answer', 'comment'].includes(body.contentType ?? '') ? body.contentType! : null;
  const reason = ['spam', 'abusive', 'secret', 'wrong', 'duplicate', 'other'].includes(body.reason ?? '')
    ? body.reason!
    : null;
  const contentId = Number(body.contentId);
  if (!contentType || !reason || !Number.isInteger(contentId)) return c.json({ error: 'invalid' }, 400);

  try {
    await db().batch(
      [
        {
          sql: `insert into flags (content_type, content_id, actor_id, reason, detail)
                values (?, ?, ?, ?, ?)`,
          args: [contentType, contentId, actor.id, reason, (body.detail ?? '').slice(0, 500) || null],
        },
        {
          sql: `insert into audit_events (actor_id, action, target_type, target_id)
                values (?, 'flag.create', ?, ?)`,
          args: [actor.id, contentType, String(contentId)],
        },
      ] as never,
      'write',
    );
  } catch {
    // One flag per actor per item; a repeat is not an error worth surfacing.
    return c.json({ ok: true, already: true });
  }
  return c.json({ ok: true }, 201);
});
