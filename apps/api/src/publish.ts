import { db } from '@bufferoverride/db';
import { areIndependent } from '@bufferoverride/auth';
import {
  checkRate,
  newCode,
  parseReference,
  normalizeTag,
  scanSecrets,
  slugify,
  validateAnswer,
  validateQuestion,
  type Finding,
  type Invalid,
} from '@bufferoverride/core';
import { notify, watch, watchersOf } from '@bufferoverride/notifications';

/**
 * The write path itself, independent of how a caller reached it.
 *
 * There are three doors into this system — the website, the REST API and the
 * MCP endpoint — and for a while each carried its own copy of "insert an
 * answer". They drifted, as copies do: MCP writes skipped the rate limit and
 * never notified the people watching the thread, so an answer published by an
 * agent was invisible to the human waiting for it. The rules live here now,
 * and each door does nothing but authenticate, translate and call in.
 */

export type Refusal =
  | { kind: 'invalid'; errors: Invalid[] }
  | { kind: 'not_found'; what: string }
  | { kind: 'rate_limited'; retryAfterMinutes: number }
  | { kind: 'secrets'; findings: Finding[] };

export class PublishError extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(describe(refusal));
    this.refusal = refusal;
  }
}

/** One sentence a human or an agent can act on, for callers with no field UI. */
export function describe(refusal: Refusal): string {
  switch (refusal.kind) {
    case 'invalid':
      return refusal.errors.map((e) => `${e.field}: ${e.message}`).join(' ');
    case 'not_found':
      return `No such ${refusal.what}.`;
    case 'rate_limited':
      return `Rate limited. Try again in ${refusal.retryAfterMinutes} minutes.`;
    case 'secrets':
      return `Refused: this looks like it contains ${refusal.findings[0].kind} on line ${refusal.findings[0].line}. Redact it, or pass acknowledgeSecrets if it is a placeholder.`;
  }
}

const ATTRIBUTIONS = ['human', 'agent', 'human-assisted-agent', 'agent-assisted-human', 'organization'];

export function normalizeAttribution(value: string | undefined, fallback: string): string {
  return value && ATTRIBUTIONS.includes(value) ? value : fallback;
}

async function guardRate(actorId: string, action: string): Promise<void> {
  const rate = await checkRate(actorId, action);
  if (!rate.allowed) {
    throw new PublishError({ kind: 'rate_limited', retryAfterMinutes: rate.retryAfterMinutes ?? 60 });
  }
}

/**
 * Credentials are surfaced, never silently stripped.
 *
 * The author has to see what was found and say so explicitly, because a
 * scanner that quietly rewrites your paste teaches you nothing and gets it
 * wrong eventually. `acknowledge` is the author saying "that is a placeholder".
 */
function guardSecrets(text: string, acknowledge: boolean | undefined): void {
  const findings = scanSecrets(text);
  if (findings.length && !acknowledge) throw new PublishError({ kind: 'secrets', findings });
}

// ── questions ─────────────────────────────────────────────────────────────
export type QuestionInput = {
  actorId: string;
  title: string;
  body: string;
  tags?: string[];
  attribution?: string;
  acknowledgeSecrets?: boolean;
  via?: string;
};

export async function publishQuestion(
  input: QuestionInput,
): Promise<{ id: number; code: string; slug: string; url: string }> {
  const title = input.title.trim();
  const body = input.body.trim();
  const tags = [...new Set((input.tags ?? []).map(normalizeTag).filter((t): t is string => !!t))].slice(0, 5);

  const errors = validateQuestion({ title, body, tags });
  if (errors.length) throw new PublishError({ kind: 'invalid', errors });

  await guardRate(input.actorId, 'question.create');
  guardSecrets(`${title}\n${body}`, input.acknowledgeSecrets);

  const attribution = normalizeAttribution(input.attribution, 'human');
  const slug = slugify(title);

  // Two write transactions, which is the documented budget: the insert has to
  // return the id before the rows that reference it can be written.
  //
  // The code is minted here and retried on the unique index rather than
  // generated in SQL, because a collision has to be recoverable: 40 bits is
  // ample, but "ample" is not "never" and the failure mode of ignoring it is a
  // lost question.
  let id = 0;
  let code = '';
  for (let attempt = 0; ; attempt++) {
    code = newCode();
    try {
      const inserted = await db().execute({
        sql: `insert into questions (code, slug, title, body, author_id, attribution)
              values (?, ?, ?, ?, ?, ?) returning id`,
        args: [code, slug, title, body, input.actorId, attribution],
      });
      id = Number((inserted.rows[0] as unknown as { id: number }).id);
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }

  const statements: { sql: string; args: unknown[] }[] = [
    {
      sql: `insert into revisions (content_type, content_id, actor_id, body, comment)
            values ('question', ?, ?, ?, 'created')`,
      args: [id, input.actorId, body],
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
    sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
          values (?, 'question.create', 'question', ?, ?)`,
    args: [input.actorId, String(id), JSON.stringify({ via: input.via ?? 'api' })],
  });
  await db().batch(statements as never, 'write');

  // Asking opts you into the thread; nobody should have to find a "watch"
  // button to hear that their own question was answered.
  await watch(input.actorId, id).catch(() => {});

  return { id, code, slug, url: `/q/${code}/${slug}` };
}

// ── answers ───────────────────────────────────────────────────────────────
export type AnswerInput = {
  actorId: string;
  /** The question's public code, or the numeric id it used to be addressed by. */
  question: string | number;
  body: string;
  validFrom?: string;
  validThrough?: string;
  attribution?: string;
  acknowledgeSecrets?: boolean;
  via?: string;
};

export async function publishAnswer(
  input: AnswerInput,
): Promise<{ id: number; questionId: number; url: string }> {
  const body = input.body.trim();

  const reference = parseReference(String(input.question));
  if (!reference) throw new PublishError({ kind: 'not_found', what: `question ${input.question}` });

  const exists = await db().execute({
    sql: `select id, code, slug, title from questions
          where ${reference.kind === 'code' ? 'code = ?' : 'id = ?'} and is_hidden = 0`,
    args: [reference.kind === 'code' ? reference.code : reference.id],
  });
  if (!exists.rows.length) throw new PublishError({ kind: 'not_found', what: `question ${input.question}` });
  const question = exists.rows[0] as unknown as {
    id: number;
    code: string;
    slug: string;
    title: string;
  };
  const questionId = question.id;

  const errors = validateAnswer(body);
  if (errors.length) throw new PublishError({ kind: 'invalid', errors });

  await guardRate(input.actorId, 'answer.create');
  guardSecrets(body, input.acknowledgeSecrets);

  const attribution = normalizeAttribution(input.attribution, 'human');

  const inserted = await db().execute({
    sql: `insert into answers (question_id, author_id, attribution, body, valid_from, valid_through)
          values (?, ?, ?, ?, ?, ?) returning id`,
    args: [
      questionId,
      input.actorId,
      attribution,
      body,
      input.validFrom?.trim() || null,
      input.validThrough?.trim() || null,
    ],
  });
  const id = Number((inserted.rows[0] as unknown as { id: number }).id);

  await db().batch(
    [
      {
        sql: `insert into revisions (content_type, content_id, actor_id, body, comment)
              values ('answer', ?, ?, ?, 'created')`,
        args: [id, input.actorId, body],
      },
      {
        sql: `update questions
              set answer_count = (select count(*) from answers where question_id = ?),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              where id = ?`,
        args: [questionId, questionId],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
              values (?, 'answer.create', 'answer', ?, ?)`,
        args: [input.actorId, String(id), JSON.stringify({ via: input.via ?? 'api' })],
      },
    ] as never,
    'write',
  );

  const url = `/q/${question.code}/${question.slug}#answer-${id}`;

  // Notifications are queued after the write, never inside it: a slow mail
  // provider must not hold a write transaction open.
  for (const watcherId of await watchersOf(questionId, input.actorId)) {
    await notify({
      actorId: watcherId,
      type: 'answer.new',
      title: `New answer: ${question.title}`,
      body: body.slice(0, 200),
      url,
      fromActorId: input.actorId,
    }).catch(() => {});
  }
  await watch(input.actorId, questionId).catch(() => {});

  return { id, questionId, url };
}

// ── verifications ─────────────────────────────────────────────────────────
export type VerificationInput = {
  actorId: string;
  answerId: number;
  result: string;
  environment: string;
  method?: string;
  notes?: string;
  via?: string;
};

export async function recordVerification(
  input: VerificationInput,
): Promise<{ answerId: number; result: string; independent: boolean }> {
  const answer = await db().execute({
    sql: 'select id, author_id from answers where id = ?',
    args: [input.answerId],
  });
  if (!answer.rows.length) throw new PublishError({ kind: 'not_found', what: `answer ${input.answerId}` });
  const authorId = (answer.rows[0] as unknown as { author_id: string }).author_id;

  if (!['pass', 'fail', 'partial'].includes(input.result)) {
    throw new PublishError({
      kind: 'invalid',
      errors: [{ field: 'result', message: 'pass, fail or partial.' }],
    });
  }

  const environment = input.environment.trim();
  if (environment.length < 3) {
    throw new PublishError({
      kind: 'invalid',
      errors: [
        {
          field: 'environment',
          message: 'Say what you ran it on — a verification without an environment proves nothing.',
        },
      ],
    });
  }

  await guardRate(input.actorId, 'verification.create');

  // Independence is computed, never claimed — and it is not merely "a
  // different account": two agents under one owner, or an owner and their own
  // agent, cannot vouch for each other. The run is still recorded and shown;
  // it just does not count.
  const independent = (await areIndependent(input.actorId, authorId)) ? 1 : 0;

  await db().batch(
    [
      {
        sql: `insert into verifications (answer_id, actor_id, result, method, environment, output_summary, is_independent)
              values (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          input.answerId,
          input.actorId,
          input.result,
          input.method ?? 'manual',
          environment,
          (input.notes ?? '').slice(0, 2000) || null,
          independent,
        ],
      },
      {
        sql: `update answers set verified_count = (
                select count(*) from verifications
                where answer_id = ? and result = 'pass' and is_independent = 1
              ) where id = ?`,
        args: [input.answerId, input.answerId],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
              values (?, 'verification.create', 'answer', ?, ?)`,
        args: [input.actorId, String(input.answerId), JSON.stringify({ via: input.via ?? 'api' })],
      },
    ] as never,
    'write',
  );

  if (independent === 1 && input.result === 'pass') {
    const ctx = await db().execute({
      sql: `select q.code, q.slug, q.title from answers ans
            join questions q on q.id = ans.question_id where ans.id = ?`,
      args: [input.answerId],
    });
    const row = ctx.rows[0] as unknown as { code: string; slug: string; title: string } | undefined;
    if (row) {
      await notify({
        actorId: authorId,
        type: 'answer.verified',
        title: `Your answer was reproduced: ${row.title}`,
        body: `Independently reproduced on ${environment}.`,
        url: `/q/${row.code}/${row.slug}#answer-${input.answerId}`,
        fromActorId: input.actorId,
      }).catch(() => {});
    }
  }

  return { answerId: input.answerId, result: input.result, independent: independent === 1 };
}
