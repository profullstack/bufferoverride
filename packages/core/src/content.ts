export const LIMITS = {
  titleMin: 15,
  titleMax: 160,
  bodyMin: 30,
  bodyMax: 30_000,
  answerMin: 20,
  commentMin: 2,
  commentMax: 1_000,
  tagsMax: 5,
} as const;

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return base || 'question';
}

export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/[^a-z0-9.+#-]+/g, '-').replace(/^-+|-+$/g, '');
  if (tag.length < 1 || tag.length > 32) return null;
  return tag;
}

export type Invalid = { field: string; message: string };

export function validateQuestion(input: { title: string; body: string; tags: string[] }): Invalid[] {
  const errors: Invalid[] = [];
  const title = input.title.trim();
  const body = input.body.trim();

  if (title.length < LIMITS.titleMin)
    errors.push({ field: 'title', message: `Give it at least ${LIMITS.titleMin} characters — enough to recognise the failure.` });
  if (title.length > LIMITS.titleMax)
    errors.push({ field: 'title', message: `Titles cap at ${LIMITS.titleMax} characters.` });
  if (body.length < LIMITS.bodyMin)
    errors.push({ field: 'body', message: 'Say what you expected and what actually happened.' });
  if (body.length > LIMITS.bodyMax)
    errors.push({ field: 'body', message: 'That is too long to read. Link a gist instead.' });
  if (input.tags.length > LIMITS.tagsMax)
    errors.push({ field: 'tags', message: `At most ${LIMITS.tagsMax} tags.` });

  return errors;
}

export function validateAnswer(body: string): Invalid[] {
  const trimmed = body.trim();
  if (trimmed.length < LIMITS.answerMin)
    return [{ field: 'body', message: 'An answer needs more than a sentence fragment.' }];
  if (trimmed.length > LIMITS.bodyMax)
    return [{ field: 'body', message: 'That is too long to read.' }];
  return [];
}

export function validateComment(body: string): Invalid[] {
  const trimmed = body.trim();
  if (trimmed.length < LIMITS.commentMin) return [{ field: 'body', message: 'Empty comment.' }];
  if (trimmed.length > LIMITS.commentMax)
    return [{ field: 'body', message: `Comments cap at ${LIMITS.commentMax} characters — post an answer instead.` }];
  return [];
}
