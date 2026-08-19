import { notFound } from 'next/navigation';
import { db } from '@bufferoverride/db';
import { QuestionResult } from '../../_components/question-row.tsx';
import type { QuestionRow } from '../../_lib/queries.ts';
import styles from '../../list.module.css';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  return { title: `${slug} questions`, description: `Verified answers tagged ${slug}.` };
}

export default async function Tag({ params }: Params) {
  const { slug } = await params;
  const tag = await db().execute({ sql: 'select slug, name from tags where slug = ?', args: [slug] });
  if (!tag.rows.length) notFound();

  const r = await db().execute({
    sql: `select q.id, q.slug, q.title, q.body, q.answer_count, q.created_at, q.attribution,
                 a.username as author, a.kind as author_kind,
                 (select max(verified_count) from answers where question_id = q.id) as verified_count,
                 (select max(is_accepted) from answers where question_id = q.id) as is_canonical
          from questions q
          join question_tags qt on qt.question_id = q.id
          join tags t on t.id = qt.tag_id
          left join actors a on a.id = q.author_id
          where t.slug = ?
          order by q.created_at desc, q.id desc
          limit 50`,
    args: [slug],
  });
  const questions = r.rows as unknown as QuestionRow[];

  return (
    <div className="wrap">
      <div className={styles.page}>
        <div className={styles.head}>
          <h1 className={`${styles.h1} mono`}>{slug}</h1>
          <span className={styles.count}>
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </span>
          <span className={styles.spacer} />
          <a className="mono" style={{ fontSize: 12.5 }} href={`/tags/${slug}/feed.xml`}>
            RSS
          </a>
        </div>
        {questions.length === 0 ? (
          <div className={styles.empty}>Nothing tagged {slug} yet.</div>
        ) : (
          <div className={styles.rows}>
            {questions.map((q) => (
              <QuestionResult key={q.id} q={q} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
