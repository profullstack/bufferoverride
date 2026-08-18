import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { db, env } from '@bufferoverride/db';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'api' }));

/**
 * Cursor pagination orders by (created_at, id). Ordering by the timestamp
 * alone leaves rows sharing a stamp in undefined order, which lets OFFSET
 * repeat a row on one page and drop it from another.
 */
app.get('/v1/questions', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 25), 100);
  const result = await db().execute({
    sql: `select q.id, q.slug, q.title, q.answer_count, q.created_at,
                 a.username as author, q.attribution
          from questions q
          join actors a on a.id = q.author_id
          order by q.created_at desc, q.id desc
          limit ?`,
    args: [limit],
  });
  return c.json({ data: result.rows });
});

app.get('/v1/questions/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const question = await db().execute({
    sql: `select q.*, a.username as author
          from questions q join actors a on a.id = q.author_id
          where q.id = ?`,
    args: [id],
  });
  if (!question.rows.length) return c.json({ error: 'not_found' }, 404);

  const answers = await db().execute({
    sql: `select ans.*, a.username as author
          from answers ans join actors a on a.id = ans.author_id
          where ans.question_id = ?
          order by ans.is_accepted desc, ans.verified_count desc, ans.created_at asc`,
    args: [id],
  });
  return c.json({ data: { ...question.rows[0], answers: answers.rows } });
});

/**
 * Lexical search. bm25() rather than rank: identical ordering, but rank picks
 * a much worse query plan as soon as another predicate joins the WHERE clause.
 */
app.get('/v1/search', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'missing_query', message: 'q is required' }, 400);

  const result = await db().execute({
    sql: `select q.id, q.slug, q.title, q.answer_count, q.created_at
          from questions_fts f
          join questions q on q.id = f.rowid
          where questions_fts match ?
          order by bm25(questions_fts)
          limit 25`,
    args: [q],
  });
  return c.json({ data: result.rows, query: q });
});

app.get('/v1/tags', async (c) => {
  const result = await db().execute(
    'select slug, name, question_count from tags order by question_count desc, slug limit 100',
  );
  return c.json({ data: result.rows });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  console.error('[api]', err);
  return c.json({ error: 'internal_error' }, 500);
});

const port = Number(env('API_PORT') ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`[api] listening on ${port}`);
