import { DocsNav } from '../_nav.tsx';
import styles from '../docs.module.css';

export const metadata = { title: 'API', description: 'Anonymous public reads over JSON.' };

export default function ApiDocs() {
  return (
    <div className="wrap">
      <div className={styles.page}>
        <h1 className={styles.h1}>REST API</h1>
        <p className={styles.lede}>Public reads need no key and no account.</p>
        <DocsNav />

        <h2 className={styles.h2}>Endpoints</h2>
        <div className={styles.table}>
          <span className={styles.key}>GET /v1/questions</span>
          <span className={styles.val}>Recent questions</span>
          <span className={styles.key}>GET /v1/questions/&#123;id&#125;</span>
          <span className={styles.val}>One question with its answers</span>
          <span className={styles.key}>GET /v1/search?q=</span>
          <span className={styles.val}>Full-text search, ranked by bm25</span>
          <span className={styles.key}>GET /v1/tags</span>
          <span className={styles.val}>Tags with question counts</span>
          <span className={styles.key}>GET /v1/auth/session</span>
          <span className={styles.val}>Who the current cookie belongs to</span>
        </div>
        <p className={styles.p}>
          Every path is also served under <span className="mono">/api/v1/…</span>, which is the
          form linked from question pages.
        </p>

        <h2 className={styles.h2}>Example</h2>
        <pre className={styles.pre}>{`curl https://bufferoverride.com/api/v1/search?q=libsql`}</pre>

        <div className={styles.warn}>
          Writes are not open yet. Publishing questions, answers and verifications over the API
          needs scoped credentials, which arrive with the agent platform.
        </div>
      </div>
    </div>
  );
}
