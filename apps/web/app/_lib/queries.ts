import { db } from '@bufferoverride/db';

export type QuestionRow = {
  id: number;
  slug: string;
  title: string;
  body: string;
  answer_count: number;
  created_at: string;
  author: string | null;
  author_kind: string | null;
  attribution: string;
  verified_count: number | null;
  is_canonical: number | null;
};

/**
 * List rows carry enough state to render a result without a second query:
 * answer count, best answer's verification count, and whether one is accepted.
 * Ordered by (created_at, id) — a timestamp alone leaves rows sharing a stamp
 * in undefined order, which lets OFFSET repeat one page's row on another.
 */
export async function listQuestions(limit = 25): Promise<QuestionRow[]> {
  const result = await db().execute({
    sql: `select q.id, q.slug, q.title, q.body, q.answer_count, q.created_at,
                 q.attribution, a.username as author, a.kind as author_kind,
                 (select max(verified_count) from answers where question_id = q.id) as verified_count,
                 (select max(is_accepted) from answers where question_id = q.id) as is_canonical
          from questions q
          left join actors a on a.id = q.author_id
          where q.is_hidden = 0
          order by q.created_at desc, q.id desc
          limit ?`,
    args: [limit],
  });
  return result.rows as unknown as QuestionRow[];
}

/** bm25(), never rank: identical ordering, far better plan once filters join. */
export async function searchQuestions(q: string, limit = 25): Promise<QuestionRow[]> {
  const result = await db().execute({
    sql: `select q.id, q.slug, q.title, q.body, q.answer_count, q.created_at,
                 q.attribution, a.username as author, a.kind as author_kind,
                 (select max(verified_count) from answers where question_id = q.id) as verified_count,
                 (select max(is_accepted) from answers where question_id = q.id) as is_canonical
          from questions_fts f
          join questions q on q.id = f.rowid
          left join actors a on a.id = q.author_id
          where questions_fts match ? and q.is_hidden = 0
          order by bm25(questions_fts)
          limit ?`,
    args: [q, limit],
  });
  return result.rows as unknown as QuestionRow[];
}

export type AnswerRow = {
  id: number;
  score: number;
  author_id: string;
  body: string;
  author: string | null;
  author_kind: string | null;
  attribution: string;
  is_accepted: number;
  verified_count: number;
  valid_from: string | null;
  valid_through: string | null;
  is_stale: number;
  created_at: string;
};

export async function getQuestion(id: number, viewerId?: string) {
  const question = await db().execute({
    sql: `select q.*, a.username as author, a.kind as author_kind
          from questions q left join actors a on a.id = q.author_id
          where q.id = ? and q.is_hidden = 0`,
    args: [id],
  });
  if (!question.rows.length) return null;

  const answers = await db().execute({
    sql: `select ans.id, ans.body, ans.attribution, ans.is_accepted, ans.verified_count,
                 ans.valid_from, ans.valid_through, ans.is_stale, ans.created_at,
                 ans.score, ans.author_id,
                 a.username as author, a.kind as author_kind
          from answers ans left join actors a on a.id = ans.author_id
          where ans.question_id = ? and ans.is_hidden = 0
          order by ans.is_stale asc, ans.is_accepted desc, ans.verified_count desc, ans.created_at asc`,
    args: [id],
  });

  const verifications = await db().execute({
    sql: `select v.result, v.environment, v.is_independent, v.created_at, a.username as actor
          from verifications v
          join answers ans on ans.id = v.answer_id
          left join actors a on a.id = v.actor_id
          where ans.question_id = ?
          order by v.created_at desc
          limit 8`,
    args: [id],
  });

  const tags = await db().execute({
    sql: `select t.slug from question_tags qt join tags t on t.id = qt.tag_id
          where qt.question_id = ? order by t.slug`,
    args: [id],
  });

  const comments = await db().execute({
    sql: `select c.content_type, c.content_id, c.body, c.created_at, a.username as author
          from comments c left join actors a on a.id = c.author_id
          where c.is_deleted = 0
            and ((c.content_type = 'question' and c.content_id = ?)
              or (c.content_type = 'answer' and c.content_id in
                  (select id from answers where question_id = ?)))
          order by c.created_at`,
    args: [id, id],
  });

  // One query for every vote this viewer has cast on this page.
  const myVotes = viewerId
    ? await db().execute({
        sql: `select content_type, content_id, value from votes
              where actor_id = ?
                and ((content_type = 'question' and content_id = ?)
                  or (content_type = 'answer' and content_id in
                      (select id from answers where question_id = ?)))`,
        args: [viewerId, id, id],
      })
    : { rows: [] as unknown[] };

  const canonicalRow = await db().execute({
    sql: `select c.body, c.works_with, c.known_exceptions, c.state, c.updated_at,
                 (select count(*) from canonical_answer_revisions where question_id = ?) as revisions,
                 (select count(*) from canonical_challenges where question_id = ? and state = 'open') as open_challenges
          from canonical_answers c where c.question_id = ?`,
    args: [id, id, id],
  });

  const contributors = await db().execute({
    sql: `select distinct a.username, a.kind from canonical_answer_revisions rev
          join actors a on a.id = rev.actor_id where rev.question_id = ?`,
    args: [id],
  });

  return {
    canonical: (canonicalRow.rows[0] ?? null) as unknown as {
      body: string;
      works_with: string | null;
      known_exceptions: string | null;
      state: string;
      updated_at: string;
      revisions: number;
      open_challenges: number;
    } | null,
    contributors: contributors.rows as unknown as { username: string; kind: string }[],
    comments: comments.rows as unknown as {
      content_type: string;
      content_id: number;
      body: string;
      created_at: string;
      author: string | null;
    }[],
    votes: myVotes.rows as unknown as { content_type: string; content_id: number; value: number }[],
    question: question.rows[0] as unknown as QuestionRow & { body: string },
    answers: answers.rows as unknown as AnswerRow[],
    verifications: verifications.rows as unknown as {
      result: string;
      environment: string | null;
      is_independent: number;
      created_at: string;
      actor: string | null;
    }[],
    tags: (tags.rows as unknown as { slug: string }[]).map((t) => t.slug),
  };
}

/** Days elapsed, floored — used for "verified 4d ago" style metadata. */
export function daysAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
