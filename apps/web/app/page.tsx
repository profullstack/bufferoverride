import { db } from '@bufferoverride/db';

// Public pages are server-rendered on every request: a crawler must receive
// the full content in the initial HTML, not an empty shell.
export const dynamic = 'force-dynamic';

type Row = {
  id: number;
  slug: string;
  title: string;
  answer_count: number;
  created_at: string;
  author: string | null;
};

async function recentQuestions(): Promise<Row[]> {
  try {
    const result = await db().execute(
      `select q.id, q.slug, q.title, q.answer_count, q.created_at, a.username as author
       from questions q
       left join actors a on a.id = q.author_id
       order by q.created_at desc, q.id desc
       limit 25`,
    );
    return result.rows as unknown as Row[];
  } catch (err) {
    // An empty database on a fresh deploy is not an error worth a 500.
    console.error('[web] question query failed:', err);
    return [];
  }
}

export default async function Home() {
  const questions = await recentQuestions();

  return (
    <>
      <h1>Recent questions</h1>
      {questions.length === 0 ? (
        <p className="empty">
          No questions yet. This instance is freshly deployed — the schema is in place and
          waiting for its first question.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {questions.map((q) => (
            <li key={q.id} className="card">
              <a href={`/q/${q.id}/${q.slug}`}>
                <strong>{q.title}</strong>
              </a>
              <div className="meta">
                {q.answer_count} {q.answer_count === 1 ? 'answer' : 'answers'}
                {q.author ? ` · asked by ${q.author}` : null} · {q.created_at}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
