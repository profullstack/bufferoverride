import { db, env } from '@bufferoverride/db';

/**
 * The notification catalogue.
 *
 * Each type is something that happened to *your* content or to a question you
 * chose to follow — never "activity near you". The defaults reflect that: the
 * things you cannot act on are on by web only, and nothing is on by email
 * unless it plausibly needs you to do something.
 */
export const TYPES = [
  {
    type: 'answer.new',
    label: 'Someone answers your question',
    defaults: { email: true, web: true },
  },
  {
    type: 'answer.verified',
    label: 'Your answer is independently reproduced',
    defaults: { email: true, web: true },
  },
  {
    type: 'answer.accepted',
    label: 'Your answer is accepted',
    defaults: { email: true, web: true },
  },
  {
    type: 'question.watched',
    label: 'Activity on a question you watch',
    defaults: { email: false, web: true },
  },
  {
    type: 'canonical.challenged',
    label: 'A canonical answer you wrote is challenged',
    defaults: { email: true, web: true },
  },
  {
    type: 'comment.new',
    label: 'Someone comments on your post',
    defaults: { email: false, web: true },
  },
  {
    type: 'moderation.action',
    label: 'Moderation affects your content',
    defaults: { email: true, web: true },
  },
] as const;

export type NotificationType = (typeof TYPES)[number]['type'];

const DEFAULTS = new Map(TYPES.map((t) => [t.type, t.defaults]));

export async function preferencesFor(actorId: string) {
  const r = await db().execute({
    sql: 'select type, email, web from notification_preferences where actor_id = ?',
    args: [actorId],
  });
  const saved = new Map(
    (r.rows as unknown as { type: string; email: number; web: number }[]).map((row) => [
      row.type,
      { email: row.email === 1, web: row.web === 1 },
    ]),
  );
  return TYPES.map((t) => ({
    type: t.type,
    label: t.label,
    ...(saved.get(t.type) ?? t.defaults),
  }));
}

export async function setPreference(
  actorId: string,
  type: string,
  channel: 'email' | 'web',
  on: boolean,
): Promise<void> {
  if (!DEFAULTS.has(type as NotificationType)) throw new Error(`unknown notification type: ${type}`);
  const fallback = DEFAULTS.get(type as NotificationType)!;

  await db().execute({
    sql: `insert into notification_preferences (actor_id, type, email, web)
          values (?, ?, ?, ?)
          on conflict (actor_id, type) do update set
            ${channel} = excluded.${channel}`,
    args: [
      actorId,
      type,
      channel === 'email' ? (on ? 1 : 0) : fallback.email ? 1 : 0,
      channel === 'web' ? (on ? 1 : 0) : fallback.web ? 1 : 0,
    ],
  });
}

async function wants(actorId: string, type: string) {
  const r = await db().execute({
    sql: 'select email, web from notification_preferences where actor_id = ? and type = ?',
    args: [actorId, type],
  });
  const row = r.rows[0] as unknown as { email: number; web: number } | undefined;
  if (row) return { email: row.email === 1, web: row.web === 1 };
  return DEFAULTS.get(type as NotificationType) ?? { email: false, web: true };
}

/**
 * Queue a notification.
 *
 * Never notifies an actor about their own action — the overwhelming majority
 * of "someone answered" events on a small site are you answering yourself.
 * Email is not sent inline: the row is written with emailed_at null and the
 * worker claims it, so a slow provider cannot slow down a write path.
 */
export async function notify(input: {
  actorId: string;
  type: NotificationType;
  title: string;
  body?: string;
  url?: string;
  fromActorId?: string;
}): Promise<void> {
  if (input.fromActorId && input.fromActorId === input.actorId) return;

  const pref = await wants(input.actorId, input.type);
  if (!pref.email && !pref.web) return;

  await db().execute({
    sql: `insert into notifications (actor_id, type, title, body, url, actor_from, emailed_at)
          values (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.actorId,
      input.type,
      input.title,
      input.body ?? null,
      input.url ?? null,
      input.fromActorId ?? null,
      // Marked as already handled when the actor does not want email, so the
      // sender never has to re-check preferences.
      pref.email ? null : new Date().toISOString(),
    ],
  });
}

/** Everyone watching a question, minus whoever caused the event. */
export async function watchersOf(questionId: number, exceptActorId?: string): Promise<string[]> {
  const r = await db().execute({
    sql: `select actor_id from watches where question_id = ?
          union
          select author_id from questions where id = ?`,
    args: [questionId, questionId],
  });
  return (r.rows as unknown as { actor_id: string }[])
    .map((row) => row.actor_id)
    .filter((id) => id && id !== exceptActorId);
}

export async function watch(actorId: string, questionId: number): Promise<void> {
  await db().execute({
    sql: 'insert or ignore into watches (actor_id, question_id) values (?, ?)',
    args: [actorId, questionId],
  });
}

export async function unwatch(actorId: string, questionId: number): Promise<void> {
  await db().execute({
    sql: 'delete from watches where actor_id = ? and question_id = ?',
    args: [actorId, questionId],
  });
}

export async function inbox(actorId: string, limit = 30) {
  const r = await db().execute({
    sql: `select n.id, n.type, n.title, n.body, n.url, n.read_at, n.created_at,
                 a.username as from_username
          from notifications n
          left join actors a on a.id = n.actor_from
          where n.actor_id = ? order by n.created_at desc limit ?`,
    args: [actorId, limit],
  });
  return r.rows as unknown as {
    id: number;
    type: string;
    title: string;
    body: string | null;
    url: string | null;
    read_at: string | null;
    created_at: string;
    from_username: string | null;
  }[];
}

export async function unreadCount(actorId: string): Promise<number> {
  const r = await db().execute({
    sql: 'select count(*) as n from notifications where actor_id = ? and read_at is null',
    args: [actorId],
  });
  return Number((r.rows[0] as unknown as { n: number }).n);
}

export async function markAllRead(actorId: string): Promise<void> {
  await db().execute({
    sql: `update notifications set read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          where actor_id = ? and read_at is null`,
    args: [actorId],
  });
}

/**
 * Send queued notification emails. Called by the worker, never inline.
 * Claims a batch, sends, then stamps — a send that fails is retried next tick
 * rather than lost.
 */
export async function flushEmails(limit = 25): Promise<number> {
  const key = env('RESEND_API_KEY');
  if (!key) return 0;

  const pending = await db().execute({
    sql: `select n.id, n.title, n.body, n.url, a.email
          from notifications n join actors a on a.id = n.actor_id
          where n.emailed_at is null and a.email is not null
          order by n.created_at limit ?`,
    args: [limit],
  });

  const rows = pending.rows as unknown as {
    id: number;
    title: string;
    body: string | null;
    url: string | null;
    email: string;
  }[];
  if (rows.length === 0) return 0;

  const base = (env('PUBLIC_BASE_URL') ?? 'https://bufferoverride.com').replace(/\/$/, '');
  const from = env('MAIL_FROM') ?? 'BufferOverride <login@bufferoverride.com>';
  // Delivered, or permanently undeliverable. Both are "done": retrying a 422
  // for a malformed address forever would mean the queue never drains and the
  // same rejection is logged every tick.
  const settled: number[] = [];
  let delivered = 0;

  for (const row of rows) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: row.email,
          subject: row.title,
          text: [
            row.title,
            row.body ? `\n${row.body}` : '',
            row.url ? `\n${base}${row.url}` : '',
            `\n\nTurn this off: ${base}/account/notifications`,
          ].join(''),
        }),
      });
      if (res.ok) {
        settled.push(row.id);
        delivered++;
        continue;
      }

      const detail = await res.text();
      // 429 and 5xx are worth another attempt; 4xx means this message will
      // never be accepted no matter how often it is offered.
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) settled.push(row.id);
      console.error(
        `[notifications] resend ${res.status} (${retryable ? 'will retry' : 'giving up'}):`,
        detail,
      );
    } catch (err) {
      // A network failure is transient by definition — leave it queued.
      console.error('[notifications] send failed, will retry:', err);
    }
  }

  if (settled.length) {
    await db().execute({
      sql: `update notifications set emailed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            where id in (${settled.map(() => '?').join(',')})`,
      args: settled,
    });
  }
  return delivered;
}
