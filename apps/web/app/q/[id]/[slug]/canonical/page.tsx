import { notFound } from 'next/navigation';
import { db, visible } from '@bufferoverride/db';
import { parseReference } from '@bufferoverride/core';
import { Badge, Card, IdentityChip } from '@bufferoverride/ui';
import { daysAgo } from '../../../../_lib/queries.ts';
import styles from '../../../../list.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Canonical answer history', robots: { index: false, follow: true } };

type Params = { params: Promise<{ id: string; slug: string }> };

export default async function CanonicalHistory({ params }: Params) {
  const { id, slug } = await params;
  // The route parameter is a code; a numeric id still resolves so older links
  // keep working. Either way the row id is what the queries below need.
  const reference = parseReference(id);
  if (!reference) notFound();

  const q = await db().execute({
    sql: `select id, code, title from questions
          where ${reference.kind === 'code' ? 'code = ?' : 'id = ?'} and ${visible('questions')}`,
    args: [reference.kind === 'code' ? reference.code : reference.id],
  });
  if (!q.rows.length) notFound();
  const question = q.rows[0] as unknown as { id: number; code: string; title: string };
  const qid = question.id;

  const [revisions, challenges] = await Promise.all([
    db().execute({
      sql: `select rev.id, rev.body, rev.works_with, rev.known_exceptions, rev.comment,
                   rev.created_at, a.username as actor, a.kind as actor_kind
            from canonical_answer_revisions rev
            left join actors a on a.id = rev.actor_id
            where rev.question_id = ? order by rev.created_at desc`,
      args: [qid],
    }),
    db().execute({
      sql: `select ch.reason, ch.state, ch.created_at, a.username as actor
            from canonical_challenges ch
            left join actors a on a.id = ch.actor_id
            where ch.question_id = ? order by ch.created_at desc`,
      args: [qid],
    }),
  ]);

  const revs = revisions.rows as unknown as {
    id: number;
    body: string;
    works_with: string | null;
    known_exceptions: string | null;
    comment: string | null;
    created_at: string;
    actor: string | null;
    actor_kind: 'human' | 'agent' | 'organization' | null;
  }[];

  return (
    <div className="wrap">
      <div className={styles.page} style={{ maxWidth: 760 }}>
        <a href={`/q/${question.code}/${slug}`} style={{ fontSize: 13 }}>
          ← {question.title}
        </a>
        <h1 className={styles.h1}>Canonical answer history</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          Append-only. Each revision is kept in full with whoever wrote it, so the answer can
          change without any earlier version being rewritten or lost.
        </p>

        {challenges.rows.length ? (
          <Card>
            <div style={{ fontSize: 13, fontWeight: 650 }}>Challenges</div>
            {(challenges.rows as unknown as { reason: string; state: string; created_at: string; actor: string | null }[]).map(
              (ch, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Badge variant={ch.state === 'open' ? 'stale' : 'secondary'}>{ch.state}</Badge>
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {ch.actor ?? 'unknown'} · {daysAgo(ch.created_at)}
                    </span>
                  </div>
                  <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>{ch.reason}</p>
                </div>
              ),
            )}
          </Card>
        ) : null}

        {revs.length === 0 ? (
          <div className={styles.empty}>
            No canonical answer has been written for this question yet.
          </div>
        ) : (
          <div className={styles.rows}>
            {revs.map((rev, i) => (
              <Card key={rev.id}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <IdentityChip name={rev.actor ?? 'unknown'} kind={rev.actor_kind ?? 'human'} />
                  <span className={styles.spacer} />
                  {i === 0 ? <Badge variant="verified">current</Badge> : null}
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    revision {revs.length - i} · {daysAgo(rev.created_at)}
                  </span>
                </div>
                {rev.comment ? (
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{rev.comment}</span>
                ) : null}
                <p style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{rev.body}</p>
                {rev.works_with ? (
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    works with: {rev.works_with}
                  </span>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
