import { db } from '@bufferoverride/db';
import { Card } from '@bufferoverride/ui';
import styles from '../list.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tags' };

export default async function Tags() {
  const r = await db().execute(
    'select slug, name, description, question_count from tags order by question_count desc, slug',
  );
  const tags = r.rows as unknown as {
    slug: string;
    name: string;
    description: string | null;
    question_count: number;
  }[];

  return (
    <div className="wrap">
      <div className={styles.page}>
        <div className={styles.head}>
          <h1 className={styles.h1}>Tags</h1>
          <span className={styles.count}>{tags.length}</span>
        </div>
        {tags.length === 0 ? (
          <div className={styles.empty}>No tags yet. They appear as questions are published.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {tags.map((t) => (
              <Card key={t.slug}>
                <a className="mono" href={`/tags/${t.slug}`} style={{ fontSize: 14, fontWeight: 600 }}>
                  {t.slug}
                </a>
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {t.description ?? `${t.question_count} ${t.question_count === 1 ? 'question' : 'questions'}`}
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
