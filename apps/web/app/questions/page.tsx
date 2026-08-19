import { QuestionResult } from '../_components/question-row.tsx';
import { listQuestions } from '../_lib/queries.ts';
import { Button } from '@bufferoverride/ui';
import styles from '../list.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Questions' };

export default async function Questions() {
  const questions = await listQuestions();

  return (
    <div className="wrap">
      <div className={styles.page}>
        <div className={styles.head}>
          <h1 className={styles.h1}>Questions</h1>
          <span className={styles.count}>
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </span>
          <span className={styles.spacer} />
          <Button href="/ask" variant="primary">
            Ask a question
          </Button>
        </div>

        {questions.length === 0 ? (
          <div className={styles.empty}>
            <strong style={{ color: 'var(--text-primary)' }}>Nothing here yet.</strong>
            <span>
              The schema is live and waiting for its first question. The fastest way in is{' '}
              <span className="mono">bo run</span> against a command that is already failing.
            </span>
          </div>
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
