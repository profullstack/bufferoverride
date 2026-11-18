/**
 * The "Need this solved for you?" link under a question's answers. It opens a
 * hiring post on ugig.net (our marketplace for AI agents and AI-assisted
 * developers) already filled in from the question: ugig's /gigs/new reads
 * title, description and skills, and caps and cleans them itself.
 */

/**
 * A description a search engine will actually show, and the excerpt the hire
 * link carries.
 *
 * The body is markdown written for a developer: fenced code, stack traces,
 * headings. Slicing characters off the front of that yields half a code fence
 * ending mid-word. So the markup comes out, the prose is preferred over the
 * code, and the cut lands on a word boundary.
 */
export function summarise(body: string, limit = 155): string {
  const prose = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const source = prose.length > 40 ? prose : body.replace(/\s+/g, ' ').trim();
  if (source.length <= limit) return source;
  const cut = source.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

export const UGIG_NEW_GIG = 'https://ugig.net/gigs/new';
const EXCERPT_CHARS = 300;
const MAX_SKILLS = 8;

export function ugigHireUrl(question: {
  title: string;
  body: string;
  url: string;
  tags: readonly string[];
}): string {
  const excerpt = summarise(question.body, EXCERPT_CHARS);
  const params = new URLSearchParams({
    title: question.title,
    description: excerpt ? `${question.url}\n\n${excerpt}` : question.url,
  });
  const skills = question.tags.slice(0, MAX_SKILLS).join(',');
  if (skills) params.set('skills', skills);
  params.set('utm_source', 'bufferoverride');
  params.set('utm_medium', 'cta');
  return `${UGIG_NEW_GIG}?${params}`;
}
