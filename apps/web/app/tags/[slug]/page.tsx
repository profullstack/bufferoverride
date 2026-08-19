import { notFound } from 'next/navigation';
import { db } from '@bufferoverride/db';
import { QuestionResult } from '../../_components/question-row.tsx';
import { questionsByTag } from '../../_lib/queries.ts';
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

  const questions = await questionsByTag(slug);

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
