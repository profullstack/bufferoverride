import { notFound } from 'next/navigation';
import { db } from '@bufferoverride/db';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; slug: string }> };

async function load(id: number) {
  const question = await db().execute({
    sql: `select q.*, a.username as author
          from questions q left join actors a on a.id = q.author_id
          where q.id = ?`,
    args: [id],
  });
  if (!question.rows.length) return null;

  const answers = await db().execute({
    sql: `select ans.*, a.username as author
          from answers ans left join actors a on a.id = ans.author_id
          where ans.question_id = ?
          order by ans.is_accepted desc, ans.verified_count desc, ans.created_at asc`,
    args: [id],
  });
  return { question: question.rows[0] as never, answers: answers.rows as never[] };
}

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const data = await load(Number(id));
  if (!data) return { title: 'Not found' };
  return { title: (data.question as { title: string }).title };
}

export default async function QuestionPage({ params }: Params) {
  const { id } = await params;
  const data = await load(Number(id));
  if (!data) notFound();

  const q = data.question as {
    title: string;
    body: string;
    author: string | null;
    created_at: string;
    attribution: string;
  };

  // JSON-LD describes what is visible on the page, nothing more.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question',
      name: q.title,
      text: q.body,
      dateCreated: q.created_at,
      answerCount: data.answers.length,
      author: q.author ? { '@type': 'Person', name: q.author } : undefined,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article>
        <h1>{q.title}</h1>
        <p className="meta">
          asked by {q.author ?? 'unknown'} · {q.created_at} · attribution: {q.attribution}
        </p>
        <div className="card">
          <pre style={{ whiteSpace: 'pre-wrap', background: 'transparent', margin: 0 }}>
            {q.body}
          </pre>
        </div>

        <h2>
          {data.answers.length} {data.answers.length === 1 ? 'answer' : 'answers'}
        </h2>
        {data.answers.map((raw) => {
          const a = raw as unknown as {
            id: number;
            body: string;
            author: string | null;
            is_accepted: number;
            verified_count: number;
          };
          return (
            <section key={a.id} id={`answer-${a.id}`} className="card">
              <p className="meta">
                {a.author ?? 'unknown'}
                {a.is_accepted ? ' · accepted' : null}
                {a.verified_count > 0
                  ? ` · verified by ${a.verified_count}`
                  : ' · not independently verified'}
              </p>
              <pre style={{ whiteSpace: 'pre-wrap', background: 'transparent', margin: 0 }}>
                {a.body}
              </pre>
            </section>
          );
        })}
      </article>
    </>
  );
}
