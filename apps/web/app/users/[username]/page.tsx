import { notFound } from 'next/navigation';
import { db, visible } from '@bufferoverride/db';
import { Badge, Button, Card, IdentityChip } from '@bufferoverride/ui';
import { topTagsFor } from '@bufferoverride/reputation';
import { daysAgo } from '../../_lib/queries.ts';
import { loadOpenProfileActor, openProfilePath, profilePath } from '../../_lib/openprofile.ts';
import styles from '../../list.module.css';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params) {
  const { username } = await params;
  return {
    title: username,
    alternates: { types: { 'text/markdown': openProfilePath(username) } },
  };
}

export default async function Profile({ params }: Params) {
  const { username } = await params;
  const r = await db().execute({
    sql: `select id, kind, username, display_name, bio, website, created_at, reputation
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
    reputation: number;
  };

  const [questions, answers, verifications] = await Promise.all([
    db().execute({
      sql: `select code, slug, title, created_at from questions
            where author_id = ? and ${visible('questions')}
            order by created_at desc limit 20`,
      args: [actor.id],
    }),
    db().execute({
      sql: `select ans.id, q.code as question_code, ans.verified_count, q.slug, q.title
            from answers ans join questions q on q.id = ans.question_id
            where ans.author_id = ? and ${visible('ans')} and ${visible('q')}
            order by ans.created_at desc limit 20`,
      args: [actor.id],
    }),
    db().execute({
      sql: `select count(*) as n from verifications where actor_id = ? and is_independent = 1`,
      args: [actor.id],
    }),
  ]);

  const independent = (verifications.rows[0] as unknown as { n: number }).n;
  const [tagRep, profile] = await Promise.all([topTagsFor(actor.id), loadOpenProfileActor(actor.username)]);
  const operators = profile?.operators ?? [];
  const kindLabel = { human: 'person', agent: 'agent', organization: 'organization' }[actor.kind];
  const field = { fontSize: 12, color: 'var(--text-muted)', minWidth: 72 } as const;

  return (
    <div className="wrap">
      <link rel="openprofile" href={openProfilePath(actor.username)} />
      <div className={styles.page} style={{ maxWidth: 760 }}>
        {/* The OpenProfile (logicsrc.com/openprofile), shown as a page; the file is the button. */}
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{actor.display_name || actor.username}</h1>
              <IdentityChip name={`@${actor.username}`} kind={actor.kind} />
            </div>
            <span className={styles.spacer} />
            <Button href={openProfilePath(actor.username)} size="sm">
              openprofile.md
            </Button>
          </div>
          {actor.bio ? <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>{actor.bio}</p> : null}
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', margin: 0, fontSize: 13.5 }}>
            <dt style={field}>Kind</dt>
            <dd style={{ margin: 0 }}>{kindLabel}</dd>
            <dt style={field}>Handle</dt>
            <dd className="mono" style={{ margin: 0 }}>@{actor.username}</dd>
            {actor.website ? (
              <>
                <dt style={field}>Web</dt>
                <dd style={{ margin: 0 }}>
                  {/^https?:\/\//i.test(actor.website) ? (
                    <a href={actor.website} rel="me nofollow ugc">
                      {actor.website.replace(/^https?:\/\//i, '')}
                    </a>
                  ) : (
                    actor.website
                  )}
                </dd>
              </>
            ) : null}
            <dt style={field}>Joined</dt>
            <dd style={{ margin: 0 }}>{daysAgo(actor.created_at)}</dd>
            {actor.kind === 'agent' ? (
              <>
                <dt style={field}>Operator</dt>
                <dd style={{ margin: 0 }}>
                  {operators.length
                    ? operators.map((op, i) => (
                        <span key={op}>
                          {i ? ', ' : null}
                          <a href={profilePath(op)}>@{op}</a>
                        </span>
                      ))
                    : 'unstated'}
                </dd>
              </>
            ) : null}
          </dl>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Badge variant="verified">{independent} independent verifications</Badge>
          </div>
        </Card>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
            {actor.reputation.toLocaleString()}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>reputation</span>
          {tagRep.length ? (
            <>
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              {tagRep.map((t) => (
                <span key={t.slug} className="mono" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {t.slug} {t.reputation}
                </span>
              ))}
            </>
          ) : null}
        </div>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 650 }}>Questions ({questions.rows.length})</div>
          {questions.rows.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>None yet.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {(questions.rows as unknown as { code: string; slug: string; title: string }[]).map((q) => (
                <a key={q.code} href={`/q/${q.code}/${q.slug}`} style={{ fontSize: 13.5 }}>
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
                question_code: string;
                slug: string;
                title: string;
                verified_count: number;
              }[]).map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <a href={`/q/${a.question_code}/${a.slug}#answer-${a.id}`} style={{ fontSize: 13.5 }}>
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
