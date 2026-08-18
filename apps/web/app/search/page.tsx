import { QuestionResult } from '../_components/question-row.tsx';
import { searchQuestions } from '../_lib/queries.ts';
import { SearchIcon } from '@bufferoverride/ui';
import styles from '../list.module.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Search',
  // Internal search results are not index-worthy pages.
  robots: { index: false, follow: true },
};

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const results = query ? await searchQuestions(query) : [];

  return (
    <div className="wrap">
      <div className={styles.page}>
        <form className={styles.searchForm} action="/search" role="search">
          <SearchIcon size={16} />
          <input
            className={styles.searchInput}
            type="search"
            name="q"
            defaultValue={query}
            placeholder="worker exited before finishing"
            aria-label="Search questions"
          />
          <span className={styles.searchNote}>bm25</span>
        </form>

        {query ? (
          <div className={styles.head}>
            <span className={styles.count}>
              <strong style={{ color: 'var(--text-primary)' }}>{results.length}</strong> matching{' '}
              <span className="mono">{query}</span>
            </span>
          </div>
        ) : null}

        {query && results.length === 0 ? (
          <div className={styles.empty}>
            <strong style={{ color: 'var(--text-primary)' }}>No matches.</strong>
            <span>Nobody has published this failure yet — which makes it worth asking.</span>
          </div>
        ) : (
          <div className={styles.rows}>
            {results.map((r) => (
              <QuestionResult key={r.id} q={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
