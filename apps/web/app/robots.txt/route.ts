import { baseUrl } from '../_lib/xml.ts';

/**
 * Search and citation crawlers are welcome. Training crawlers stay disallowed
 * until the contributor content licence is settled — see PRD 13.7 and 28.
 */
export function GET() {
  const base = baseUrl();
  const body = `User-agent: *
Allow: /
Disallow: /account
Disallow: /login
Disallow: /signup
Disallow: /auth/
Disallow: /search

User-agent: OAI-SearchBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Google-Extended
Disallow: /

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
