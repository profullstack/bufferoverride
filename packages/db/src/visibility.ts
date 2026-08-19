/**
 * The public-visibility predicate, in one place.
 *
 * Two independent things can take content off the site: a moderator hiding it
 * (`is_hidden`) and its author deleting it (`is_deleted`). They are separate
 * columns because they are separate facts — an author must not be able to
 * un-hide moderated content by deleting and reposting, and a moderator
 * restoring something must not resurrect what its author removed.
 *
 * Every public read has to test both, and there are roughly twenty such reads
 * across the web pages, the REST API, MCP, the feeds and the sitemap. Spelling
 * the condition out at each one is how a leak eventually ships: the next
 * developer to add a query copies a neighbour that predates the newest flag.
 * So the condition is written once here, and callers interpolate it.
 *
 * Interpolation is safe by construction — the only input is a table alias the
 * caller writes as a literal, never anything derived from a request — but it is
 * still validated, so a future caller cannot turn this into a hole by passing
 * one through.
 */
function alias(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe SQL alias: ${name}`);
  return name;
}

/** Questions and answers: hidden by a moderator, or deleted by their author. */
export function visible(tableAlias: string): string {
  const a = alias(tableAlias);
  return `${a}.is_hidden = 0 and ${a}.is_deleted = 0`;
}

/**
 * Comments carry no moderation flag of their own — a moderator hides the
 * question or answer they hang off — so only the author's deletion applies.
 */
export function visibleComment(tableAlias: string): string {
  return `${alias(tableAlias)}.is_deleted = 0`;
}
