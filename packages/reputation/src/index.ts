import { db } from '@bufferoverride/db';

/**
 * What reputation is for here.
 *
 * Not a leaderboard. It answers one question: how much weight should a reader
 * give this actor in this subject. So the weights reward the behaviours the
 * platform is actually built on — being reproduced by someone independent, and
 * doing the reproducing — well above being agreed with.
 *
 * Every value is derived from current rows. Reverse a vote, delete an answer,
 * uphold a flag, and the points go with it; there is no counter to drift.
 */
export const WEIGHTS = {
  answerUpvote: 10,
  answerDownvote: -2,
  questionUpvote: 5,
  accepted: 15,
  /** Someone independent reproduced your answer. The strongest signal we have. */
  verificationReceived: 20,
  /** You did the reproducing. Unglamorous, and the thing the corpus needs most. */
  verificationGiven: 5,
  upheldFlag: -25,
} as const;

const OVERALL_SQL = `
  select a.id as actor_id, cast(coalesce(
      (select sum(case when v.value > 0 then ${WEIGHTS.answerUpvote} else ${WEIGHTS.answerDownvote} end)
         from votes v join answers ans on ans.id = v.content_id
        where v.content_type = 'answer' and ans.author_id = a.id and ans.is_hidden = 0), 0)
    + coalesce(
      (select sum(case when v.value > 0 then ${WEIGHTS.questionUpvote} else 0 end)
         from votes v join questions q on q.id = v.content_id
        where v.content_type = 'question' and q.author_id = a.id and q.is_hidden = 0), 0)
    + coalesce(
      (select count(*) * ${WEIGHTS.accepted} from answers
        where author_id = a.id and is_accepted = 1 and is_hidden = 0), 0)
    + coalesce(
      (select count(*) * ${WEIGHTS.verificationReceived} from verifications ver
         join answers ans on ans.id = ver.answer_id
        where ans.author_id = a.id and ver.is_independent = 1 and ver.result = 'pass'
          and ans.is_hidden = 0), 0)
    + coalesce(
      (select count(*) * ${WEIGHTS.verificationGiven} from verifications
        where actor_id = a.id and is_independent = 1), 0)
    + coalesce(
      (select count(*) * ${WEIGHTS.upheldFlag} from flags
        where state = 'upheld' and (
          (content_type = 'answer'   and content_id in (select id from answers   where author_id = a.id)) or
          (content_type = 'question' and content_id in (select id from questions where author_id = a.id)) or
          (content_type = 'comment'  and content_id in (select id from comments  where author_id = a.id))
        )), 0)
  as integer) as reputation
  from actors a`;

/** Per-tag standing, attributed through the question an answer belongs to. */
const TAG_SQL = `
  select ans.author_id as actor_id, qt.tag_id, cast(
      count(distinct case when ans.is_accepted = 1 then ans.id end) * ${WEIGHTS.accepted}
    + count(distinct case when ver.is_independent = 1 and ver.result = 'pass' then ver.id end)
        * ${WEIGHTS.verificationReceived}
    + coalesce(sum(distinct 0), 0)
  as integer) as reputation
  from answers ans
  join question_tags qt on qt.question_id = ans.question_id
  left join verifications ver on ver.answer_id = ans.id
  where ans.is_hidden = 0
  group by ans.author_id, qt.tag_id
  having reputation <> 0`;

/**
 * Recompute everything in two write transactions.
 *
 * Whole-table recomputation rather than incremental updates: write
 * transactions serialize per database, so one pass over every actor costs far
 * less than a write per scoring event, and it cannot drift out of step with
 * the rows it is derived from.
 */
export async function recomputeReputation(): Promise<{ actors: number; tagRows: number }> {
  const client = db();

  const overall = await client.execute(OVERALL_SQL);
  const rows = overall.rows as unknown as { actor_id: string; reputation: number }[];
  const changed = rows.filter((r) => r.reputation !== 0 || true);

  if (changed.length) {
    await client.batch(
      changed.map((r) => ({
        sql: `update actors set reputation = ?,
                     reputation_computed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              where id = ? and reputation <> ?`,
        args: [r.reputation, r.actor_id, r.reputation],
      })) as never,
      'write',
    );
  }

  const tagRows = (await client.execute(TAG_SQL)).rows as unknown as {
    actor_id: string;
    tag_id: number;
    reputation: number;
  }[];

  await client.batch(
    [
      { sql: 'delete from actor_tag_reputation', args: [] },
      ...tagRows.map((r) => ({
        sql: 'insert into actor_tag_reputation (actor_id, tag_id, reputation) values (?, ?, ?)',
        args: [r.actor_id, r.tag_id, r.reputation],
      })),
    ] as never,
    'write',
  );

  return { actors: changed.length, tagRows: tagRows.length };
}

export async function topTagsFor(actorId: string, limit = 4) {
  const r = await db().execute({
    sql: `select t.slug, r.reputation from actor_tag_reputation r
          join tags t on t.id = r.tag_id
          where r.actor_id = ? order by r.reputation desc limit ?`,
    args: [actorId, limit],
  });
  return r.rows as unknown as { slug: string; reputation: number }[];
}

/**
 * Privileges are earned, and the thresholds are deliberately low: the point is
 * to keep a brand-new account from moderating, not to build a hierarchy.
 */
export const PRIVILEGE = { flagReview: 200, hideContent: 500 } as const;

export function canReviewFlags(reputation: number): boolean {
  return reputation >= PRIVILEGE.flagReview;
}
