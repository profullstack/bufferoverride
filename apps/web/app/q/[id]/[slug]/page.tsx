import { cookies } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { isLegacyId, jsonForScript, renderMarkdown } from '@bufferoverride/core';
import { SESSION_COOKIE, actorFromSessionToken } from '@bufferoverride/auth';
import { db } from '@bufferoverride/db';
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
  EditableAnswer,
  EditableQuestion,
  CanonicalEditor,
  ChallengeControl,
  CommentThread,
  FlagControl,
  VerifyControl,
  VoteControl,
} from '../../interactive.tsx';
import { CopyMarkdown } from '../../../_components/copy-markdown.tsx';
import { Markdown } from '../../../_components/markdown.tsx';
import styles from '../../question.module.css';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; slug: string }> };

/**
 * A description a search engine will actually show.
 *
 * The body is markdown written for a developer: fenced code, stack traces,
 * headings. Slicing 180 characters off the front of that yields half a code
 * fence ending mid-word, which is what a search result was showing. So the
 * markup comes out, the prose is preferred over the code, and the cut lands on
 * a word boundary.
 */
function summarise(body: string, limit = 155): string {
  const prose = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const source = prose.length > 40 ? prose : body.replace(/\s+/g, ' ').trim();
  if (source.length <= limit) return source;
  const cut = source.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * The title carries what the asker wrote plus the one fact that distinguishes
 * this page in a list of ten blue links: whether the thing has a verified
 * answer. "Sqlite3 one-write limitation" and "Sqlite3 one-write limitation —
 * answered, 2 independent reproductions" compete very differently, and the
 * second is true or it does not get said.
 */
function titleFor(question: { title: string }, answers: AnswerRow[]): string {
  const verified = answers.reduce((best, a) => Math.max(best, a.verified_count ?? 0), 0);
  const accepted = answers.some((a) => a.is_accepted);

  if (verified > 0) {
    return `${question.title} — answered, verified ${verified}${verified === 1 ? ' time' : ' times'}`;
  }
  if (accepted) return `${question.title} — answered`;
  if (answers.length) return `${question.title} — ${answers.length} answer${answers.length === 1 ? '' : 's'}`;
  return question.title;
}

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const data = await getQuestion(id);
  if (!data) return { title: 'Not found', robots: { index: false, follow: true } };

  const { question: q, answers } = data;
  const path = `/q/${q.code}/${q.slug}`;
  const description = summarise(q.body);

  return {
    title: titleFor(q, answers),
    description,
    // One address per question. Without this, the legacy numeric URL, a stale
    // slug and the code URL are three pages to a crawler, splitting whatever
    // authority the page earns three ways.
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      title: q.title,
      description,
      url: path,
      publishedTime: q.created_at,
      modifiedTime: q.updated_at ?? q.created_at,
      authors: q.author ? [q.author] : undefined,
    },
    twitter: { card: 'summary', title: q.title, description },
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
  const { id, slug } = await params;
  const jar = await cookies();
  const viewer = await actorFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  const data = await getQuestion(id, viewer?.id);
  if (!data) notFound();

  // Every question has exactly one address. A numeric id is an URL from before
  // codes existed, and a stale slug is a title that has since been edited;
  // both resolve, and both redirect permanently rather than serving a second
  // copy of the page for a crawler to weigh separately.
  if (isLegacyId(id) || slug !== data.question.slug) {
    permanentRedirect(`/q/${data.question.code}/${data.question.slug}`);
  }

  const { question: q, answers, verifications, tags, comments, votes, canonical, contributors } = data;
  const signedIn = !!viewer;
  const viewerReputation = viewer
    ? Number(
        (
          (
            await db().execute({ sql: 'select reputation from actors where id = ?', args: [viewer.id] })
          ).rows[0] as unknown as { reputation: number }
        )?.reputation ?? 0,
      )
    : 0;
  const isAsker = !!viewer && (q as unknown as { author_id: string }).author_id === viewer.id;
  // Which actors' content this viewer may revise: themselves, plus any agent
  // they own — an agent posts under its owner's responsibility, so an owner who
  // cannot retract its output has no way to clean up after a bad run. This only
  // decides which buttons are drawn; the API re-derives the same answer, so a
  // request that skips the page gets the same refusal.
  const ownedIds = new Set<string>(viewer ? [viewer.id] : []);
  if (viewer) {
    const owned = await db().execute({
      sql: 'select agent_id from agent_owners where owner_id = ?',
      args: [viewer.id],
    });
    for (const row of owned.rows as unknown as { agent_id: string }[]) ownedIds.add(row.agent_id);
  }
  const mine = (authorId: string) => ownedIds.has(authorId);
  // Same bootstrapping rule the API enforces: solving the question earns the
  // right to write its canonical answer.
  const wroteAccepted =
    !!viewer && answers.some((a) => a.is_accepted === 1 && a.author_id === viewer.id);
  const voteFor = (type: string, cid: number) =>
    votes.find((v) => v.content_type === type && v.content_id === cid)?.value ?? 0;
  const commentsFor = (type: string, cid: number) =>
    comments
      .filter((cm) => cm.content_type === type && cm.content_id === cid)
      .map((cm) => ({ ...cm, mine: mine(cm.author_id) }));
  // A written canonical answer speaks for the question. Absent one, the best
  // current answer stands in — labelled as exactly that, never as canonical.
  const best = pickCanonical(answers);
  const independent = verifications.filter((v) => v.is_independent && v.result === 'pass').length;

  const canonicalUrl = `https://bufferoverride.com/q/${q.code}/${q.slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'QAPage',
    // The page URL belongs in the graph: without it a QAPage cannot be tied
    // back to the address that should rank for it.
    '@id': canonicalUrl,
    url: canonicalUrl,
    mainEntity: {
      '@type': 'Question',
      '@id': `${canonicalUrl}#question`,
      name: q.title,
      text: q.body,
      url: canonicalUrl,
      dateCreated: q.created_at,
      dateModified: q.updated_at ?? q.created_at,
      answerCount: answers.length,
      author: q.author ? { '@type': 'Person', name: q.author } : undefined,
      acceptedAnswer: canonical
        ? { '@type': 'Answer', text: canonical.body, url: `${canonicalUrl}/canonical` }
        : best
          ? {
              '@type': 'Answer',
              text: best.body,
              url: `${canonicalUrl}#answer-${best.id}`,
              upvoteCount: best.verified_count,
              dateCreated: best.created_at,
              author: best.author ? { '@type': 'Person', name: best.author } : undefined,
            }
          : undefined,
      suggestedAnswer: answers
        .filter((a) => a.id !== best?.id)
        .map((a) => ({
          '@type': 'Answer',
          text: a.body,
          url: `${canonicalUrl}#answer-${a.id}`,
          upvoteCount: a.verified_count,
          dateCreated: a.created_at,
          author: a.author ? { '@type': 'Person', name: a.author } : undefined,
        })),
    },
  };

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd) }}
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
            <span className="mono">{q.code}</span>
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

          {canonical || best ? (
            <section className={styles.capsule} aria-label="Canonical answer">
              <div
                className={styles.capsuleHead}
                style={
                  canonical?.state === 'stale'
                    ? {
                        background: 'var(--status-stale-soft)',
                        borderColor: 'var(--status-stale-border)',
                        color: 'var(--status-stale)',
                      }
                    : undefined
                }
              >
                {canonical?.state === 'stale' ? <ClockIcon size={15} /> : <CheckIcon size={15} />}
                <span className={styles.capsuleTitle}>
                  {canonical
                    ? canonical.state === 'stale'
                      ? 'Canonical answer — challenged'
                      : 'Canonical answer'
                    : 'Best current answer'}
                </span>
                <span className={styles.spacer} />
                <span className={styles.capsuleRev}>
                  {canonical
                    ? `revision ${canonical.revisions} · updated ${daysAgo(canonical.updated_at)}`
                    : `not yet written · ${daysAgo(best!.created_at)}`}
                </span>
              </div>
              <div className={styles.capsuleBody}>
                <div className={styles.capsuleFacts}>
                  {canonical?.works_with ? (
                    <VersionPill>{canonical.works_with}</VersionPill>
                  ) : best && (best.valid_from || best.valid_through) ? (
                    <VersionPill>
                      {best.valid_from ?? 'any'} – {best.valid_through ?? 'current'}
                    </VersionPill>
                  ) : null}
                  {independent > 0 ? (
                    <Badge variant="verified">
                      <CheckIcon />
                      reproduced by {independent} independent
                    </Badge>
                  ) : (
                    <Badge variant="stale">
                      <ClockIcon />
                      not independently verified
                    </Badge>
                  )}
                  {canonical?.open_challenges ? (
                    <Badge variant="stale">
                      {canonical.open_challenges} open challenge
                      {canonical.open_challenges === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                </div>

                <Markdown lead source={canonical ? canonical.body : best!.body} />

                {canonical?.known_exceptions ? (
                  <div className={styles.block}>
                    <div className={styles.blockLabel}>KNOWN EXCEPTIONS</div>
                    <Markdown
                      source={canonical.known_exceptions}
                      className={styles.blockBody}
                    />
                  </div>
                ) : null}

                <Separator />
                <div className={styles.capsuleFoot}>
                  <CopyMarkdown
                    source={canonical ? canonical.body : best!.body}
                    html={renderMarkdown(canonical ? canonical.body : best!.body)}
                  />
                  {canonical ? (
                    contributors.length ? (
                      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                        Maintained by{' '}
                        {contributors.map((cn) => cn.username).join(', ')}
                      </span>
                    ) : null
                  ) : (
                    <IdentityChip
                      name={best!.author ?? 'unknown'}
                      kind={kindOf(best!.author_kind)}
                      attribution={best!.attribution}
                    />
                  )}
                  <span className={styles.spacer} />
                  <Button href={`/q/${q.id}/${q.slug}/canonical`} variant="outline" size="sm">
                    History
                  </Button>
                  <CanonicalEditor
                    questionId={q.id}
                    current={canonical}
                    canEdit={signedIn && (viewerReputation >= 100 || wroteAccepted)}
                  />
                  {canonical ? <ChallengeControl questionId={q.id} signedIn={signedIn} /> : null}
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
              <span className={styles.headSpacer} />
              <CopyMarkdown source={q.body} html={renderMarkdown(q.body)} />
            </div>
            <EditableQuestion
              code={q.code}
              title={q.title}
              body={q.body}
              tags={tags}
              editedAt={(q as unknown as { edited_at: string | null }).edited_at}
              canEdit={mine((q as unknown as { author_id: string }).author_id)}
            />
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
              <span className={styles.spacer} />
              <FlagControl contentType="question" contentId={q.id} signedIn={signedIn} />
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
              <EditableAnswer
                answerId={a.id}
                body={a.body}
                validFrom={a.valid_from}
                validThrough={a.valid_through}
                editedAt={a.edited_at}
                verified={a.verified_count}
                canEdit={mine(a.author_id)}
              />
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
                <span className={styles.spacer} />
                <CopyMarkdown source={a.body} html={renderMarkdown(a.body)} />
                <FlagControl contentType="answer" contentId={a.id} signedIn={signedIn} />
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
              {best ? ` --answer ${best.id}` : ''}
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
