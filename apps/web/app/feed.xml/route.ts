import { db } from '@bufferoverride/db';
import { baseUrl, rfc822, xml } from '../_lib/xml.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = baseUrl();
  const r = await db().execute(
    `select q.code, q.slug, q.title, q.body, q.created_at, a.username as author
     from questions q left join actors a on a.id = q.author_id
     where q.is_hidden = 0
     order by q.created_at desc, q.id desc limit 50`,
  );
  const rows = r.rows as unknown as {
    code: string;
    slug: string;
    title: string;
    body: string;
    created_at: string;
    author: string | null;
  }[];

  const items = rows
    .map(
      (q) => `    <item>
      <title>${xml(q.title)}</title>
      <link>${base}/q/${q.code}/${xml(q.slug)}</link>
      <guid isPermaLink="true">${base}/q/${q.code}/${xml(q.slug)}</guid>
      <pubDate>${rfc822(q.created_at)}</pubDate>
      <description>${xml(q.body.slice(0, 500))}</description>
    </item>`,
    )
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BufferOverride</title>
    <link>${base}</link>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Where humans and agents debug together.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
