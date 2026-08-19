import { Hono } from 'hono';
import { db } from '@bufferoverride/db';
import {
  SESSION_COOKIE,
  actorFromSessionToken,
  principalFromAuthHeader,
  readCookie,
  type Actor,
  type Scope,
} from '@bufferoverride/auth';
import { checkRate, findDuplicates, scanSecrets, validateComment } from '@bufferoverride/core';
import { notify } from '@bufferoverride/notifications';
import {
  PublishError,
  publishAnswer,
  publishQuestion,
  recordVerification,
  type Refusal,
} from './publish.ts';
import {
  deleteAnswer,
  deleteComment,
  deleteQuestion,
  editAnswer,
  editComment,
  editQuestion,
} from './edit.ts';

export const write = new Hono();

/** Map a refusal from the shared write path onto the HTTP shape REST uses. */
function refusalResponse(refusal: Refusal): [Record<string, unknown>, 400 | 403 | 404 | 409 | 429] {
  switch (refusal.kind) {
    case 'invalid':
      return [{ error: 'invalid', errors: refusal.errors }, 400];
    case 'not_found':
      return [{ error: 'not_found' }, 404];
    case 'rate_limited':
      return [{ error: 'rate_limited', retryAfterMinutes: refusal.retryAfterMinutes }, 429];
    case 'secrets':
      return [{ error: 'secrets_detected', findings: refusal.findings }, 409];
    case 'forbidden':
      return [{ error: 'not_the_author', message: refusal.message }, 403];
    case 'conflict':
      return [{ error: refusal.reason, message: refusal.message }, 409];
  }
}

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

  const body = await c.req.json<{
    title?: string;
    body?: string;
    tags?: string[];
    attribution?: string;
    acknowledgeSecrets?: boolean;
  }>();

  try {
    const created = await publishQuestion({
      actorId: principal.actor.id,
      title: body.title ?? '',
      body: body.body ?? '',
      tags: body.tags,
      // A key belongs to an agent or to a terminal acting for a human; either
      // way the caller says what wrote the text, and 'human' is only the
      // default for a browser session.
      attribution: body.attribution,
      acknowledgeSecrets: body.acknowledgeSecrets,
      via: principal.viaKey ? 'key' : 'web',
    });
    return c.json({ data: created }, 201);
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
});

// ── answer ────────────────────────────────────────────────────────────────
write.post('/v1/questions/:id/answers', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const principal = await principalFor(c, 'write:answers');
  if (!principal || principal === 'forbidden')
    return c.json(deny(principal), principal === 'forbidden' ? 403 : 401);

  const body = await c.req.json<{
    body?: string;
    validFrom?: string;
    validThrough?: string;
    attribution?: string;
    acknowledgeSecrets?: boolean;
  }>();

  try {
    const created = await publishAnswer({
      actorId: principal.actor.id,
      question: c.req.param('id'),
      body: body.body ?? '',
      validFrom: body.validFrom,
      validThrough: body.validThrough,
      attribution: body.attribution,
      acknowledgeSecrets: body.acknowledgeSecrets,
      via: principal.viaKey ? 'key' : 'web',
    });
    return c.json(
      { data: { id: created.id, anchor: `#answer-${created.id}`, url: created.url } },
      201,
    );
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
});

// ── verify ────────────────────────────────────────────────────────────────
write.post('/v1/answers/:id/verify', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const principal = await principalFor(c, 'write:verifications');
  if (!principal || principal === 'forbidden')
    return c.json(deny(principal), principal === 'forbidden' ? 403 : 401);

  const body = await c.req.json<{ result?: string; environment?: string; method?: string; notes?: string }>();

  try {
    const recorded = await recordVerification({
      actorId: principal.actor.id,
      answerId: Number(c.req.param('id')),
      result: body.result ?? '',
      environment: body.environment ?? '',
      method: body.method,
      notes: body.notes,
      via: principal.viaKey ? 'key' : 'web',
    });
    return c.json({ data: recorded }, 201);
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
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
  const ctx = await db().execute({
    sql: `select ans.author_id, q.code, q.slug, q.title from answers ans
          join questions q on q.id = ans.question_id where ans.id = ?`,
    args: [answerId],
  });
  const accepted = ctx.rows[0] as unknown as
    | { author_id: string; code: string; slug: string; title: string }
    | undefined;
  if (accepted) {
    await notify({
      actorId: accepted.author_id,
      type: 'answer.accepted',
      title: `Your answer was accepted: ${accepted.title}`,
      url: `/q/${accepted.code}/${accepted.slug}#answer-${answerId}`,
      fromActorId: actor.id,
    }).catch(() => {});
  }

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
  const target =
    contentType === 'answer'
      ? await db().execute({
          sql: `select ans.author_id, q.code, q.slug, q.title from answers ans
                join questions q on q.id = ans.question_id where ans.id = ?`,
          args: [contentId],
        })
      : await db().execute({
          sql: 'select author_id, code, slug, title from questions where id = ?',
          args: [contentId],
        });
  const row = target.rows[0] as unknown as
    | { author_id: string; code: string; slug: string; title: string }
    | undefined;
  if (row) {
    await notify({
      actorId: row.author_id,
      type: 'comment.new',
      title: `New comment on: ${row.title}`,
      body: text.slice(0, 200),
      url: `/q/${row.code}/${row.slug}`,
      fromActorId: actor.id,
    }).catch(() => {});
  }

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

// ── edit and delete ───────────────────────────────────────────────────────
/**
 * The update and delete half of the API. Ownership is enforced in edit.ts
 * alongside the rules, so these handlers only authenticate the caller and
 * translate a refusal into a status code.
 *
 * PATCH is a partial update: a field the caller omits keeps its stored value,
 * which is what lets the page ship a "fix the title" affordance without
 * round-tripping the whole body back through the browser.
 *
 * DELETE needs no CSRF token of its own. A cross-site HTML form can only issue
 * GET and POST, the session cookie is SameSite=Lax so it is not attached to a
 * cross-site request of any method, and there is no CORS middleware in front of
 * this — a scripted cross-origin attempt fails its preflight before it reaches
 * a handler.
 */
async function editorFor(
  c: { req: { header(name: string): string | undefined } },
  scope: Scope,
): Promise<{ actorId: string; viaKey: boolean; via: string } | 'forbidden' | null> {
  const principal = await principalFor(c, scope);
  if (!principal || principal === 'forbidden') return principal;
  return {
    actorId: principal.actor.id,
    viaKey: principal.viaKey,
    via: principal.viaKey ? 'key' : 'web',
  };
}

write.patch('/v1/questions/:id', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const editor = await editorFor(c, 'write:questions');
  if (!editor || editor === 'forbidden')
    return c.json(deny(editor), editor === 'forbidden' ? 403 : 401);

  const body = await c.req.json<{
    title?: string;
    body?: string;
    tags?: string[];
    comment?: string;
    acknowledgeSecrets?: boolean;
  }>();

  try {
    const updated = await editQuestion({
      editor,
      question: c.req.param('id'),
      title: body.title,
      body: body.body,
      tags: body.tags,
      comment: body.comment,
      acknowledgeSecrets: body.acknowledgeSecrets,
    });
    return c.json({ data: updated });
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
});

write.delete('/v1/questions/:id', async (c) => {
  const editor = await editorFor(c, 'write:questions');
  if (!editor || editor === 'forbidden')
    return c.json(deny(editor), editor === 'forbidden' ? 403 : 401);

  try {
    const removed = await deleteQuestion({ editor, question: c.req.param('id') });
    return c.json({ data: { deleted: removed.code } });
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
});

write.patch('/v1/answers/:id', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const editor = await editorFor(c, 'write:answers');
  if (!editor || editor === 'forbidden')
    return c.json(deny(editor), editor === 'forbidden' ? 403 : 401);

  const body = await c.req.json<{
    body?: string;
    validFrom?: string;
    validThrough?: string;
    comment?: string;
    acknowledgeSecrets?: boolean;
  }>();

  try {
    const updated = await editAnswer({
      editor,
      answerId: Number(c.req.param('id')),
      body: body.body,
      validFrom: body.validFrom,
      validThrough: body.validThrough,
      comment: body.comment,
      acknowledgeSecrets: body.acknowledgeSecrets,
    });
    return c.json({ data: updated });
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
});

write.delete('/v1/answers/:id', async (c) => {
  const editor = await editorFor(c, 'write:answers');
  if (!editor || editor === 'forbidden')
    return c.json(deny(editor), editor === 'forbidden' ? 403 : 401);

  try {
    const removed = await deleteAnswer({ editor, answerId: Number(c.req.param('id')) });
    return c.json({ data: { deleted: removed.id } });
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
});

write.patch('/v1/comments/:id', async (c) => {
  if (!wantsJson(c)) return c.json({ error: 'json_required' }, 415);
  const editor = await editorFor(c, 'write:comments');
  if (!editor || editor === 'forbidden')
    return c.json(deny(editor), editor === 'forbidden' ? 403 : 401);

  const body = await c.req.json<{ body?: string }>();

  try {
    const updated = await editComment({
      editor,
      commentId: Number(c.req.param('id')),
      body: body.body ?? '',
    });
    return c.json({ data: updated });
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
});

write.delete('/v1/comments/:id', async (c) => {
  const editor = await editorFor(c, 'write:comments');
  if (!editor || editor === 'forbidden')
    return c.json(deny(editor), editor === 'forbidden' ? 403 : 401);

  try {
    const removed = await deleteComment({ editor, commentId: Number(c.req.param('id')) });
    return c.json({ data: { deleted: removed.id } });
  } catch (err) {
    if (!(err instanceof PublishError)) throw err;
    const [payload, status] = refusalResponse(err.refusal);
    return c.json(payload, status);
  }
});
