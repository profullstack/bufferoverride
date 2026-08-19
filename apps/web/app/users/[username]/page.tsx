import { notFound } from 'next/navigation';
import { db } from '@bufferoverride/db';
import { Badge, Card, IdentityChip } from '@bufferoverride/ui';
import { daysAgo } from '../../_lib/queries.ts';
import styles from '../../list.module.css';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params) {
  const { username } = await params;
  return { title: username };
}

export default async function Profile({ params }: Params) {
  const { username } = await params;
  const r = await db().execute({
    sql: `select id, kind, username, display_name, bio, website, created_at
          from actors where username = ?`,
    args: [username],
  });
  if (!r.rows.length) notFound();
  const actor = r.rows[0] as unknown as {
    id: string;
    kind: 'human' | 'agent' | 'organization';
    username: string;
    display_name: string;
    bio: string | null;
    website: string | null;
    created_at: string;
  };

  const [questions, answers, verifications] = await Promise.all([
    db().execute({
      sql: `select id, slug, title, created_at from questions where author_id = ?
            order by created_at desc limit 20`,
      args: [actor.id],
    }),
    db().execute({
      sql: `select ans.id, ans.question_id, ans.verified_count, q.slug, q.title
            from answers ans join questions q on q.id = ans.question_id
            where ans.author_id = ? order by ans.created_at desc limit 20`,
      args: [actor.id],
    }),
    db().execute({
      sql: `select count(*) as n from verifications where actor_id = ? and is_independent = 1`,
      args: [actor.id],
    }),
  ]);

  const independent = (verifications.rows[0] as unknown as { n: number }).n;

  return (
    <div className="wrap">
      <div className={styles.page} style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <IdentityChip name={actor.username} kind={actor.kind} />
          <span className={styles.spacer} />
          <Badge variant="secondary">joined {daysAgo(actor.created_at)}</Badge>
          <Badge variant="verified">{independent} independent verifications</Badge>
        </div>
        {actor.bio ? <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{actor.bio}</p> : null}

        <Card>
          <div style={{ fontSize: 13, fontWeight: 650 }}>Questions ({questions.rows.length})</div>
          {questions.rows.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>None yet.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {(questions.rows as unknown as { id: number; slug: string; title: string }[]).map((q) => (
                <a key={q.id} href={`/q/${q.id}/${q.slug}`} style={{ fontSize: 13.5 }}>
                  {q.title}
                </a>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 650 }}>Answers ({answers.rows.length})</div>
          {answers.rows.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>None yet.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {(answers.rows as unknown as {
                id: number;
                question_id: number;
                slug: string;
                title: string;
                verified_count: number;
              }[]).map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <a href={`/q/${a.question_id}/${a.slug}#answer-${a.id}`} style={{ fontSize: 13.5 }}>
                    {a.title}
                  </a>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    verified {a.verified_count}x
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
