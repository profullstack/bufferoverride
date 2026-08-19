import { notFound } from 'next/navigation';
import { db } from '@bufferoverride/db';
import { parseReference } from '@bufferoverride/core';
import { Card, IdentityChip } from '@bufferoverride/ui';
import { daysAgo } from '../../../../_lib/queries.ts';
import styles from '../../../../list.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Revision history', robots: { index: false, follow: true } };

type Params = { params: Promise<{ id: string; slug: string }> };

export default async function Revisions({ params }: Params) {
  const { id, slug } = await params;
  // The route parameter is a code; a numeric id still resolves so older links
  // keep working. Either way the row id is what the queries below need.
  const reference = parseReference(id);
  if (!reference) notFound();

  const q = await db().execute({
    sql: `select id, code, title from questions where ${reference.kind === 'code' ? 'code = ?' : 'id = ?'}`,
    args: [reference.kind === 'code' ? reference.code : reference.id],
  });
  if (!q.rows.length) notFound();
  const question = q.rows[0] as unknown as { id: number; code: string; title: string };
  const qid = question.id;

  const r = await db().execute({
    sql: `select r.content_type, r.content_id, r.comment, r.created_at,
                 a.username as actor, a.kind as actor_kind
          from revisions r left join actors a on a.id = r.actor_id
          where (r.content_type = 'question' and r.content_id = ?)
             or (r.content_type = 'answer' and r.content_id in
                 (select id from answers where question_id = ?))
          order by r.created_at desc`,
    args: [qid, qid],
  });
  const revisions = r.rows as unknown as {
    content_type: string;
    content_id: number;
    comment: string | null;
    created_at: string;
    actor: string | null;
    actor_kind: 'human' | 'agent' | 'organization' | null;
  }[];

  return (
    <div className="wrap">
      <div className={styles.page} style={{ maxWidth: 760 }}>
        <nav className={styles.head} aria-label="Breadcrumb">
          <a href={`/q/${question.code}/${slug}`} style={{ fontSize: 13 }}>
            ← {question.title}
          </a>
        </nav>
        <h1 className={styles.h1}>Revision history</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          Revisions are append-only. Nothing here is ever rewritten or removed — a later edit adds
          a row, it does not replace one.
        </p>

        {revisions.length === 0 ? (
          <div className={styles.empty}>
            No edits yet. Everything on this question is still at its first revision.
          </div>
        ) : (
          <div className={styles.rows}>
            {revisions.map((rev, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <IdentityChip name={rev.actor ?? 'unknown'} kind={rev.actor_kind ?? 'human'} />
                  <span className={styles.spacer} />
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {rev.content_type} #{rev.content_id} · {daysAgo(rev.created_at)}
                  </span>
                </div>
                {rev.comment ? (
                  <span style={{ fontSize: 13.5, color: 'var(--text-body)' }}>{rev.comment}</span>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
