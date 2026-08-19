import { baseUrl, rfc822, xml } from '../../../_lib/xml.ts';
import { questionsByTag } from '../../../_lib/queries.ts';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = baseUrl();

  // Shares the tag page's query, so a feed item and the page it mirrors can
  // never disagree about which questions exist or how they are addressed.
  const rows = await questionsByTag(slug);

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
