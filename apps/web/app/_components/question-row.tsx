import { Badge, CheckIcon, VersionPill } from '@bufferoverride/ui';
import { daysAgo, type QuestionRow } from '../_lib/queries.ts';
import styles from '../list.module.css';

export function QuestionResult({ q }: { q: QuestionRow }) {
  const unanswered = q.answer_count === 0;
  const verified = (q.verified_count ?? 0) > 0;

  return (
    <article className={`${styles.row} ${unanswered ? styles.rowOpen : ''}`}>
      <div className={styles.titleRow}>
        <a className={styles.title} href={`/q/${q.code}/${q.slug}`}>
          {q.title}
        </a>
        <span className={styles.id}>#{q.id}</span>
      </div>
      {q.body ? <p className={styles.excerpt}>{q.body}</p> : null}
      <div className={styles.tags}>
        {verified ? (
          <Badge variant="verified">
            <CheckIcon />
            verified {q.verified_count}x
          </Badge>
        ) : null}
        {unanswered ? <Badge variant="outline">unanswered</Badge> : null}
        {q.is_canonical ? <Badge variant="secondary">accepted answer</Badge> : null}
        <VersionPill>{q.attribution}</VersionPill>
        <span style={{ flexGrow: 1 }} />
        <span className={styles.meta}>
          {q.answer_count} {q.answer_count === 1 ? 'answer' : 'answers'} · asked{' '}
          {daysAgo(q.created_at)}
        </span>
      </div>
    </article>
  );
}
