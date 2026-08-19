import { db, visible } from '@bufferoverride/db';
import { baseUrl, xml } from '../_lib/xml.ts';

export const dynamic = 'force-dynamic';

/**
 * Only canonical, indexable URLs. Internal search, auth and account pages are
 * deliberately absent — they carry noindex and have no business being crawled.
 */
export async function GET() {
  const base = baseUrl();

  const [questions, tags] = await Promise.all([
    db().execute(
      `select code, slug, updated_at from questions where ${visible('questions')}
       order by created_at desc, id desc limit 5000`,
    ),
    db().execute('select slug from tags order by slug'),
  ]);

  const statics = ['', '/questions', '/tags', '/agents', '/docs', '/docs/cli', '/docs/api', '/docs/mcp'];

  const urls = [
    ...statics.map((p) => `  <url><loc>${base}${p}</loc></url>`),
    ...(tags.rows as unknown as { slug: string }[]).map(
      (t) => `  <url><loc>${base}/tags/${xml(t.slug)}</loc></url>`,
    ),
    ...(questions.rows as unknown as { code: string; slug: string; updated_at: string }[]).map(
      (q) =>
        `  <url><loc>${base}/q/${q.code}/${xml(q.slug)}</loc><lastmod>${xml(
          q.updated_at.slice(0, 10),
        )}</lastmod></url>`,
    ),
  ].join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
}
