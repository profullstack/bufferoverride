import { db, visible, visibleComment } from '@bufferoverride/db';
import {
  checkRate,
  normalizeTag,
  parseReference,
  slugify,
  validateAnswer,
  validateComment,
  validateQuestion,
} from '@bufferoverride/core';
import { notify } from '@bufferoverride/notifications';
import { PublishError, guardSecrets } from './publish.ts';

/**
 * Editing and deleting your own content, independent of how you reached it.
 *
 * This is the other half of publish.ts: the same three doors — website, REST
 * and MCP — call in here, so the ownership rule is written once. A door that
 * carried its own copy of "is this yours" is exactly the drift that let MCP
 * writes skip the rate limit, and getting it wrong here is worse than a missed
 * notification: it is one account editing another's answer.
 *
 * Three rules hold everywhere below.
 *
 * 1. Content is looked up before the caller is judged, and anything that is
 *    not publicly visible reads as absent. A caller must not be able to tell
 *    "no such question" from "hidden by a moderator" by the status code.
 * 2. Ownership is read from the stored row, never from the request. Nothing a
 *    caller sends can name the author.
 * 3. Deletion is a state change. Rows, revisions, votes and audit events all
 *    survive it, because the PRD requires deletion to preserve its audit trail
 *    and revisions to stay append-only.
 */

export type Editor = {
  actorId: string;
  /** True when the caller authenticated with an API key rather than a session. */
  viaKey: boolean;
  via?: string;
};

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/**
 * Who may edit or delete a piece of content.
 *
 * The author always may. A human may also act on content written by an agent
 * they own, because the agent posts under their name and their responsibility —
 * an owner who cannot retract their own agent's output has no way to clean up
 * after a bad run.
 *
 * That second path is closed to API keys. A key's grant is fixed by a human at
 * creation and must never widen itself; letting a key reach its owner's other
 * actors would turn one agent's credential into a lever on everything that
 * owner runs. So a key edits exactly what its own actor wrote, and nothing else.
 */
async function mayEdit(editor: Editor, authorId: string): Promise<boolean> {
  if (editor.actorId === authorId) return true;
  if (editor.viaKey) return false;

  const owned = await db().execute({
    sql: 'select 1 as ok from agent_owners where agent_id = ? and owner_id = ? limit 1',
    args: [authorId, editor.actorId],
  });
  return owned.rows.length > 0;
}

async function guardOwnership(editor: Editor, authorId: string, what: string): Promise<void> {
  if (await mayEdit(editor, authorId)) return;
  throw new PublishError({
    kind: 'forbidden',
    message: `That ${what} was written by someone else. You can only edit or delete your own.`,
  });
}

async function guardRate(actorId: string, action: string): Promise<void> {
  const rate = await checkRate(actorId, action);
  if (!rate.allowed) {
    throw new PublishError({ kind: 'rate_limited', retryAfterMinutes: rate.retryAfterMinutes ?? 60 });
  }
}

function missing(what: string): PublishError {
  return new PublishError({ kind: 'not_found', what });
}

/** Only the fields a caller actually sent are touched; the rest keep their value. */
function pick(next: string | undefined, current: string): string {
  return next === undefined ? current : next.trim();
}

// ── questions ─────────────────────────────────────────────────────────────
type QuestionRow = {
  id: number;
  code: string;
  slug: string;
  title: string;
  body: string;
  author_id: string;
};

async function loadQuestion(reference: string | number): Promise<QuestionRow> {
  const parsed = parseReference(String(reference));
  if (!parsed) throw missing(`question ${reference}`);

  const found = await db().execute({
    sql: `select id, code, slug, title, body, author_id from questions
          where ${parsed.kind === 'code' ? 'code = ?' : 'id = ?'} and ${visible('questions')}`,
    args: [parsed.kind === 'code' ? parsed.code : parsed.id],
  });
  if (!found.rows.length) throw missing(`question ${reference}`);
  return found.rows[0] as unknown as QuestionRow;
}

export type QuestionEdit = {
  editor: Editor;
  question: string | number;
  title?: string;
  body?: string;
  tags?: string[];
  comment?: string;
  acknowledgeSecrets?: boolean;
};

export async function editQuestion(
  input: QuestionEdit,
): Promise<{ id: number; code: string; slug: string; url: string }> {
  const current = await loadQuestion(input.question);
  await guardOwnership(input.editor, current.author_id, 'question');

  const title = pick(input.title, current.title);
  const body = pick(input.body, current.body);
  const retagging = input.tags !== undefined;
  const tags = [...new Set((input.tags ?? []).map(normalizeTag).filter((t): t is string => !!t))].slice(0, 5);

  const errors = validateQuestion({ title, body, tags });
  if (errors.length) throw new PublishError({ kind: 'invalid', errors });

  await guardRate(input.editor.actorId, 'question.edit');
  guardSecrets(`${title}\n${body}`, input.acknowledgeSecrets);

  // The slug is cosmetic — the code identifies the question in every URL, feed
  // and citation — so a retitle can move it without breaking a single link.
  const slug = slugify(title);

  const statements: { sql: string; args: unknown[] }[] = [
    {
      sql: `update questions
            set title = ?, body = ?, slug = ?, edited_at = ${NOW}, updated_at = ${NOW}
            where id = ?`,
      args: [title, body, slug, current.id],
    },
    {
      // Append-only: the pre-edit body is already on the stack from whichever
      // write put it there, so this row records what the question says now.
      sql: `insert into revisions (content_type, content_id, actor_id, body, comment)
            values ('question', ?, ?, ?, ?)`,
      args: [current.id, input.editor.actorId, body, (input.comment ?? '').trim() || 'edited'],
    },
  ];

  if (retagging) {
    statements.push({ sql: 'delete from question_tags where question_id = ?', args: [current.id] });
    for (const tag of tags) {
      statements.push({ sql: 'insert or ignore into tags (slug, name) values (?, ?)', args: [tag, tag] });
      statements.push({
        sql: `insert or ignore into question_tags (question_id, tag_id)
              select ?, id from tags where slug = ?`,
        args: [current.id, tag],
      });
    }
  }

  statements.push({
    sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
          values (?, 'question.edit', 'question', ?, ?)`,
    args: [
      input.editor.actorId,
      String(current.id),
      JSON.stringify({ via: input.editor.via ?? 'api', retitled: title !== current.title }),
    ],
  });

  await db().batch(statements as never, 'write');
  return { id: current.id, code: current.code, slug, url: `/q/${current.code}/${slug}` };
}

/**
 * Retract a question.
 *
 * Refused while anyone else's answer hangs off it. Someone who took the time to
 * write a reproduction should not lose it because the asker changed their mind,
 * and an answer whose question has vanished is unreadable on its own. Once only
 * the asker's own answers remain, they go with it.
 */
export async function deleteQuestion(input: {
  editor: Editor;
  question: string | number;
}): Promise<{ id: number; code: string }> {
  const current = await loadQuestion(input.question);
  await guardOwnership(input.editor, current.author_id, 'question');
  await guardRate(input.editor.actorId, 'question.delete');

  const authors = await db().execute({
    sql: `select distinct author_id from answers
          where question_id = ? and ${visible('answers')}`,
    args: [current.id],
  });
  for (const row of authors.rows as unknown as { author_id: string }[]) {
    if (!(await mayEdit(input.editor, row.author_id))) {
      throw new PublishError({
        kind: 'conflict',
        reason: 'has_other_answers',
        message:
          'This question has been answered by someone else. Editing it is fine; deleting it would take their work down too.',
      });
    }
  }

  await db().batch(
    [
      {
        sql: `update questions set is_deleted = 1, deleted_at = ${NOW}, updated_at = ${NOW} where id = ?`,
        args: [current.id],
      },
      {
        // Every remaining answer is the caller's own — the loop above refused
        // otherwise — and an answer left live under a deleted question would be
        // reachable through search with nothing to read it against.
        sql: `update answers set is_deleted = 1, deleted_at = ${NOW} where question_id = ? and is_deleted = 0`,
        args: [current.id],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
              values (?, 'question.delete', 'question', ?, ?)`,
        args: [input.editor.actorId, String(current.id), JSON.stringify({ via: input.editor.via ?? 'api' })],
      },
    ] as never,
    'write',
  );

  return { id: current.id, code: current.code };
}

// ── answers ───────────────────────────────────────────────────────────────
type AnswerRow = {
  id: number;
  question_id: number;
  author_id: string;
  body: string;
  valid_from: string | null;
  valid_through: string | null;
  is_accepted: number;
  verified_count: number;
  code: string;
  slug: string;
  title: string;
};

async function loadAnswer(answerId: number): Promise<AnswerRow> {
  if (!Number.isInteger(answerId)) throw missing(`answer ${answerId}`);
  const found = await db().execute({
    sql: `select ans.id, ans.question_id, ans.author_id, ans.body, ans.valid_from,
                 ans.valid_through, ans.is_accepted, ans.verified_count,
                 q.code, q.slug, q.title
          from answers ans join questions q on q.id = ans.question_id
          where ans.id = ? and ${visible('ans')} and ${visible('q')}`,
    args: [answerId],
  });
  if (!found.rows.length) throw missing(`answer ${answerId}`);
  return found.rows[0] as unknown as AnswerRow;
}

export type AnswerEdit = {
  editor: Editor;
  answerId: number;
  body?: string;
  validFrom?: string | null;
  validThrough?: string | null;
  comment?: string;
  acknowledgeSecrets?: boolean;
};

export async function editAnswer(input: AnswerEdit): Promise<{ id: number; url: string }> {
  const current = await loadAnswer(input.answerId);
  await guardOwnership(input.editor, current.author_id, 'answer');

  const body = pick(input.body, current.body);
  const errors = validateAnswer(body);
  if (errors.length) throw new PublishError({ kind: 'invalid', errors });

  await guardRate(input.editor.actorId, 'answer.edit');
  guardSecrets(body, input.acknowledgeSecrets);

  const validFrom =
    input.validFrom === undefined ? current.valid_from : (input.validFrom ?? '').trim() || null;
  const validThrough =
    input.validThrough === undefined ? current.valid_through : (input.validThrough ?? '').trim() || null;

  await db().batch(
    [
      {
        sql: `update answers
              set body = ?, valid_from = ?, valid_through = ?, edited_at = ${NOW}, updated_at = ${NOW}
              where id = ?`,
        args: [body, validFrom, validThrough, current.id],
      },
      {
        sql: `insert into revisions (content_type, content_id, actor_id, body, comment)
              values ('answer', ?, ?, ?, ?)`,
        args: [current.id, input.editor.actorId, body, (input.comment ?? '').trim() || 'edited'],
      },
      {
        // Verification counts are left alone, and the edit is timestamped so a
        // reader can see the body moved after the runs that vouched for it: the
        // verification log shows when each was performed, the answer shows when
        // it was last edited. Silently zeroing the count would delete other
        // people's work; claiming it still applies would be a lie.
        sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
              values (?, 'answer.edit', 'answer', ?, ?)`,
        args: [
          input.editor.actorId,
          String(current.id),
          JSON.stringify({
            via: input.editor.via ?? 'api',
            editedAfterVerification: current.verified_count > 0,
          }),
        ],
      },
    ] as never,
    'write',
  );

  return { id: current.id, url: `/q/${current.code}/${current.slug}#answer-${current.id}` };
}

/**
 * Retract an answer.
 *
 * Allowed even when it is the accepted one — it is the author's text, and there
 * is no un-accept for the asker to perform first, so refusing here would make
 * an accepted answer permanent. The question loses its acceptance and its asker
 * is told, rather than the page quietly pointing at nothing.
 */
export async function deleteAnswer(input: {
  editor: Editor;
  answerId: number;
}): Promise<{ id: number; questionId: number }> {
  const current = await loadAnswer(input.answerId);
  await guardOwnership(input.editor, current.author_id, 'answer');
  await guardRate(input.editor.actorId, 'answer.delete');

  const statements: { sql: string; args: unknown[] }[] = [
    {
      sql: `update answers set is_deleted = 1, deleted_at = ${NOW}, is_accepted = 0 where id = ?`,
      args: [current.id],
    },
    {
      sql: `update questions
            set answer_count = (select count(*) from answers
                                where question_id = ? and ${visible('answers')}),
                updated_at = ${NOW}
            where id = ?`,
      args: [current.question_id, current.question_id],
    },
    {
      sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
            values (?, 'answer.delete', 'answer', ?, ?)`,
      args: [
        input.editor.actorId,
        String(current.id),
        JSON.stringify({ via: input.editor.via ?? 'api', wasAccepted: current.is_accepted === 1 }),
      ],
    },
  ];

  if (current.is_accepted === 1) {
    statements.splice(2, 0, {
      sql: `update questions set accepted_answer_id = null where id = ? and accepted_answer_id = ?`,
      args: [current.question_id, current.id],
    });
  }

  await db().batch(statements as never, 'write');

  if (current.is_accepted === 1) {
    const asker = await db().execute({
      sql: 'select author_id from questions where id = ?',
      args: [current.question_id],
    });
    const askerId = (asker.rows[0] as unknown as { author_id: string } | undefined)?.author_id;
    if (askerId && askerId !== input.editor.actorId) {
      await notify({
        actorId: askerId,
        type: 'answer.deleted',
        title: `The accepted answer was withdrawn: ${current.title}`,
        body: 'Its author deleted it. The question is open again.',
        url: `/q/${current.code}/${current.slug}`,
        fromActorId: input.editor.actorId,
      }).catch(() => {});
    }
  }

  return { id: current.id, questionId: current.question_id };
}

// ── comments ──────────────────────────────────────────────────────────────
type CommentRow = { id: number; author_id: string; body: string };

async function loadComment(commentId: number): Promise<CommentRow> {
  if (!Number.isInteger(commentId)) throw missing(`comment ${commentId}`);
  const found = await db().execute({
    sql: `select id, author_id, body from comments where id = ? and ${visibleComment('comments')}`,
    args: [commentId],
  });
  if (!found.rows.length) throw missing(`comment ${commentId}`);
  return found.rows[0] as unknown as CommentRow;
}

export async function editComment(input: {
  editor: Editor;
  commentId: number;
  body: string;
}): Promise<{ id: number }> {
  const current = await loadComment(input.commentId);
  await guardOwnership(input.editor, current.author_id, 'comment');

  const body = input.body.trim();
  const errors = validateComment(body);
  if (errors.length) throw new PublishError({ kind: 'invalid', errors });

  await guardRate(input.editor.actorId, 'comment.edit');
  // Comments have no acknowledge path on the way in and none on the way out:
  // there is no reason to paste a credential into a one-line remark.
  guardSecrets(body, false);

  await db().batch(
    [
      {
        sql: `update comments set body = ?, edited_at = ${NOW} where id = ?`,
        args: [body, current.id],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
              values (?, 'comment.edit', 'comment', ?, ?)`,
        args: [input.editor.actorId, String(current.id), JSON.stringify({ via: input.editor.via ?? 'api' })],
      },
    ] as never,
    'write',
  );

  return { id: current.id };
}

export async function deleteComment(input: {
  editor: Editor;
  commentId: number;
}): Promise<{ id: number }> {
  const current = await loadComment(input.commentId);
  await guardOwnership(input.editor, current.author_id, 'comment');
  await guardRate(input.editor.actorId, 'comment.delete');

  await db().batch(
    [
      {
        sql: `update comments set is_deleted = 1, deleted_at = ${NOW} where id = ?`,
        args: [current.id],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
              values (?, 'comment.delete', 'comment', ?, ?)`,
        args: [input.editor.actorId, String(current.id), JSON.stringify({ via: input.editor.via ?? 'api' })],
      },
    ] as never,
    'write',
  );

  return { id: current.id };
}
