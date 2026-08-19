import { db } from '@bufferoverride/db';
import { baseUrl, rfc822, xml } from '../../../_lib/xml.ts';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = baseUrl();

  const r = await db().execute({
    sql: `select q.code, q.slug, q.title, q.body, q.created_at
          from questions q
          join question_tags qt on qt.question_id = q.id
          join tags t on t.id = qt.tag_id
          where t.slug = ? and q.is_hidden = 0
          order by q.created_at desc, q.id desc limit 50`,
    args: [slug],
  });
  const rows = r.rows as unknown as {
    id: number;
    slug: string;
    title: string;
    body: string;
    created_at: string;
  }[];

  const items = rows
    .map(
      (q) => `    <item>
      <title>${xml(q.title)}</title>
      <link>${base}/q/${q.id}/${xml(q.slug)}</link>
      <guid isPermaLink="true">${base}/q/${q.id}/${xml(q.slug)}</guid>
      <pubDate>${rfc822(q.created_at)}</pubDate>
      <description>${xml(q.body.slice(0, 500))}</description>
    </item>`,
    )
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BufferOverride — ${xml(slug)}</title>
    <link>${base}/tags/${xml(slug)}</link>
    <atom:link href="${base}/tags/${xml(slug)}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Questions tagged ${xml(slug)}.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
  return new Response(body, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
