import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { SESSION_COOKIE, actorFromSessionToken } from '@bufferoverride/auth';
import {
  Badge,
  Button,
  CheckIcon,
  ClockIcon,
  IdentityChip,
  Separator,
  VersionPill,
} from '@bufferoverride/ui';
import { daysAgo, getQuestion, type AnswerRow } from '../../../_lib/queries.ts';
import {
  AcceptControl,
  AnswerForm,
  CommentThread,
  VerifyControl,
  VoteControl,
} from '../../interactive.tsx';
import styles from '../../question.module.css';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const data = await getQuestion(Number(id));
  if (!data) return { title: 'Not found' };
  return {
    title: data.question.title,
    description: data.question.body.slice(0, 180),
  };
}

/** The capsule is derived from the best current answer, not a separate record. */
function pickCanonical(answers: AnswerRow[]): AnswerRow | undefined {
  const live = answers.filter((a) => !a.is_stale);
  return (
    live.find((a) => a.is_accepted) ??
    [...live].sort((a, b) => b.verified_count - a.verified_count)[0]
  );
}

function kindOf(k: string | null): 'human' | 'agent' | 'organization' {
  return k === 'agent' || k === 'organization' ? k : 'human';
}

export default async function QuestionPage({ params }: Params) {
  const { id } = await params;
  const jar = await cookies();
  const viewer = await actorFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  const data = await getQuestion(Number(id), viewer?.id);
  if (!data) notFound();

  const { question: q, answers, verifications, tags, comments, votes } = data;
  const signedIn = !!viewer;
  const isAsker = !!viewer && (q as unknown as { author_id: string }).author_id === viewer.id;
  const voteFor = (type: string, cid: number) =>
    votes.find((v) => v.content_type === type && v.content_id === cid)?.value ?? 0;
  const commentsFor = (type: string, cid: number) =>
    comments.filter((cm) => cm.content_type === type && cm.content_id === cid);
  const canonical = pickCanonical(answers);
  const independent = verifications.filter((v) => v.is_independent && v.result === 'pass').length;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question',
      name: q.title,
      text: q.body,
      dateCreated: q.created_at,
      answerCount: answers.length,
      author: q.author ? { '@type': 'Person', name: q.author } : undefined,
      acceptedAnswer: canonical
        ? { '@type': 'Answer', text: canonical.body, upvoteCount: canonical.verified_count }
        : undefined,
      suggestedAnswer: answers
        .filter((a) => a.id !== canonical?.id)
        .map((a) => ({ '@type': 'Answer', text: a.body })),
    },
  };

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className={styles.grid}>
        <div className={styles.main}>
          <nav className={styles.crumbs} aria-label="Breadcrumb">
            <a href="/questions">Questions</a>
            <span>/</span>
            {tags[0] ? (
              <>
                <a href={`/tags/${tags[0]}`}>{tags[0]}</a>
                <span>/</span>
              </>
            ) : null}
            <span className="mono">#{q.id}</span>
          </nav>

          <h1 className={styles.h1}>{q.title}</h1>

          <div className={styles.meta}>
            <span>Asked {daysAgo(q.created_at)}</span>
            {verifications[0] ? (
              <>
                <span className={styles.sep}>·</span>
                <span>
                  Last verified{' '}
                  <span className={styles.fresh}>{daysAgo(verifications[0].created_at)}</span>
                </span>
              </>
            ) : null}
            <span className={styles.sep}>·</span>
            <span>
              {answers.length} {answers.length === 1 ? 'answer' : 'answers'}
            </span>
          </div>

          {canonical ? (
            <section className={styles.capsule} aria-label="Canonical answer">
              <div className={styles.capsuleHead}>
                <CheckIcon size={15} />
                <span className={styles.capsuleTitle}>
                  {canonical.is_accepted ? 'Canonical answer' : 'Best current answer'}
                </span>
                <span className={styles.spacer} />
                <span className={styles.capsuleRev}>updated {daysAgo(canonical.created_at)}</span>
              </div>
              <div className={styles.capsuleBody}>
                <div className={styles.capsuleFacts}>
                  {canonical.valid_from || canonical.valid_through ? (
                    <VersionPill>
                      {canonical.valid_from ?? 'any'} – {canonical.valid_through ?? 'current'}
                    </VersionPill>
                  ) : null}
                  {canonical.verified_count > 0 ? (
                    <Badge variant="verified">
                      <CheckIcon />
                      verified {canonical.verified_count}x
                    </Badge>
                  ) : (
                    <Badge variant="stale">
                      <ClockIcon />
                      not independently verified
                    </Badge>
                  )}
                  {canonical.is_accepted ? <Badge variant="secondary">accepted by asker</Badge> : null}
                </div>

                <p className={styles.capsuleText}>{canonical.body}</p>

                <Separator />
                <div className={styles.capsuleFoot}>
                  <IdentityChip
                    name={canonical.author ?? 'unknown'}
                    kind={kindOf(canonical.author_kind)}
                    attribution={canonical.attribution}
                  />
                  <span className={styles.spacer} />
                  <Button href={`/q/${q.id}/${q.slug}/revisions`} variant="outline" size="sm">
                    History
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          <article className={styles.answer}>
            <div className={styles.answerHead}>
              <IdentityChip
                name={q.author ?? 'unknown'}
                kind={kindOf(q.author_kind)}
                attribution={q.attribution}
              />
            </div>
            <p className={styles.answerBody}>{q.body}</p>
            <div className={styles.env}>
              <div className={styles.envCell}>
                <span className={styles.envKey}>ASKED</span>
                <span className={styles.envVal}>{daysAgo(q.created_at)}</span>
              </div>
              <div className={styles.envCell}>
                <span className={styles.envKey}>ANSWERS</span>
                <span className={styles.envVal}>{answers.length}</span>
              </div>
              <div className={styles.envCell}>
                <span className={styles.envKey}>VERIFIED</span>
                <span className={styles.envVal}>{independent} independent</span>
              </div>
              <div className={styles.envCell}>
                <span className={styles.envKey}>ATTRIBUTION</span>
                <span className={styles.envVal}>{q.attribution}</span>
              </div>
            </div>
            {tags.length ? (
              <div className={styles.capsuleFacts}>
                {tags.map((t) => (
                  <a key={t} href={`/tags/${t}`}>
                    <VersionPill>{t}</VersionPill>
                  </a>
                ))}
              </div>
            ) : null}
            <div className={styles.capsuleFoot}>
              <VoteControl
                contentType="question"
                contentId={q.id}
                score={(q as unknown as { score: number }).score ?? 0}
                mine={voteFor('question', q.id)}
                signedIn={signedIn}
                ownContent={isAsker}
              />
            </div>
            <CommentThread
              contentType="question"
              contentId={q.id}
              comments={commentsFor('question', q.id)}
              signedIn={signedIn}
            />
          </article>

          <div className={styles.answersHead}>
            <h2 className={styles.h2}>
              {answers.length} {answers.length === 1 ? 'answer' : 'answers'}
            </h2>
          </div>

          {answers.map((a) => (
            <article
              key={a.id}
              id={`answer-${a.id}`}
              className={`${styles.answer} ${a.is_stale ? styles.answerStale : ''}`}
            >
              <div className={styles.answerHead}>
                <IdentityChip
                  name={a.author ?? 'unknown'}
                  kind={kindOf(a.author_kind)}
                  attribution={a.attribution}
                />
                <span className={styles.spacer} />
                {a.is_stale ? (
                  <Badge variant="stale">
                    <ClockIcon />
                    stale
                  </Badge>
                ) : a.verified_count > 0 ? (
                  <Badge variant="verified">
                    <CheckIcon />
                    verified {a.verified_count}x
                  </Badge>
                ) : (
                  <Badge variant="outline">awaiting verification</Badge>
                )}
                {a.is_accepted ? <Badge variant="secondary">accepted</Badge> : null}
              </div>
              <p className={styles.answerBody}>{a.body}</p>
              <div className={styles.validity}>
                <span className={styles.validityKey}>valid</span>
                <span>
                  {a.valid_from ?? 'any'} – {a.valid_through ?? 'current'}
                </span>
                <span className={styles.spacer} />
                <span className={styles.validityKey}>reproduced by</span>
                <span>{a.verified_count} independent</span>
              </div>
              <div className={styles.capsuleFoot}>
                <VoteControl
                  contentType="answer"
                  contentId={a.id}
                  score={a.score ?? 0}
                  mine={voteFor('answer', a.id)}
                  signedIn={signedIn}
                  ownContent={!!viewer && a.author_id === viewer.id}
                />
                <VerifyControl answerId={a.id} signedIn={signedIn} />
                {isAsker ? <AcceptControl answerId={a.id} accepted={a.is_accepted === 1} /> : null}
              </div>
              <CommentThread
                contentType="answer"
                contentId={a.id}
                comments={commentsFor('answer', a.id)}
                signedIn={signedIn}
              />
            </article>
          ))}

          <AnswerForm questionId={q.id} signedIn={signedIn} />
        </div>

        <aside className={styles.side}>
          <div className={styles.sideCard}>
            <div className={styles.sideTitle}>Reproduce this</div>
            <p className={styles.sideBody}>
              Run it in your own environment and publish the result. Verification by someone
              independent of the author is the only kind that counts.
            </p>
            <div className={styles.sideCode}>
              bo verify {q.id}
              {canonical ? ` --answer ${canonical.id}` : ''}
            </div>
          </div>

          {verifications.length ? (
            <div className={styles.sideCard}>
              <div className={styles.sideTitle}>Verification log</div>
              <div className={styles.log}>
                {verifications.map((v, i) => (
                  <div className={styles.logRow} key={i}>
                    <span
                      className={`${styles.logDot} ${v.is_independent ? '' : styles.logDotMuted}`}
                    />
                    <div>
                      <div className={styles.logMain}>
                        {v.result} · {v.environment ?? 'unspecified'}
                      </div>
                      <div className={`${styles.logMeta} ${v.is_independent ? '' : styles.logWarn}`}>
                        {v.actor ?? 'unknown'}, {daysAgo(v.created_at)}
                        {v.is_independent ? ', independent' : ', not independent'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.sideCard}>
            <div className={styles.sideTitle}>Machine formats</div>
            <div className={styles.links}>
              <a href={`/api/v1/questions/${q.id}`}>/api/v1/questions/{q.id}</a>
              <a href="/mcp">buffer://question/{q.id}</a>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
