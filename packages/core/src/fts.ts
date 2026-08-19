/**
 * Turn arbitrary user text into a safe FTS5 MATCH expression.
 *
 * FTS5 MATCH is a query language, not a string: `-` is NOT, `:` is a column
 * filter, `(` groups, `*` is a prefix, `"` quotes, and OR/AND/NOT are
 * keywords. Passing raw input through means a query like `catch-all` is parsed
 * as `catch NOT all`, and `TypeError: x` as a column lookup that does not
 * exist — which is a 500, not a search.
 *
 * That matters more here than on most sites: people arrive pasting error
 * messages, and error messages are almost entirely punctuation.
 *
 * So the input is tokenised and every token re-quoted as a literal. The cost
 * is that FTS5's own operators are unavailable to users; the benefit is that
 * every possible input is a valid, predictable query.
 */
export function toFtsQuery(raw: string, mode: 'and' | 'or' = 'and'): string | null {
  const tokens = (raw ?? '')
    .toLowerCase()
    // Keep the characters that are meaningful inside identifiers and versions
    // (dots, plus, hash, underscore) and split on everything else.
    .split(/[^a-z0-9_.+#]+/)
    .map((t) => t.replace(/^[.+#]+|[.+#]+$/g, ''))
    .filter((t) => t.length > 0 && t.length <= 64)
    .slice(0, 16);

  if (tokens.length === 0) return null;

  const quoted = tokens.map((t) => `"${t.replace(/"/g, '""')}"`);
  return quoted.join(mode === 'and' ? ' AND ' : ' OR ');
}

/**
 * The query plan for "someone pasted an error message".
 *
 * Requiring every token (AND) gives precision, but a pasted stack trace shares
 * only a few tokens with the question that answers it, so AND alone usually
 * returns nothing — the exact case this product exists to serve. Requiring any
 * token (OR) finds it, but ranks noise highly on short queries.
 *
 * So: try AND, and fall back to OR only when AND found nothing. The cost is a
 * second read on a miss, which is cheap; the benefit is that both a two-word
 * query and a forty-token traceback behave sensibly.
 */
export function ftsAttempts(raw: string): string[] {
  const and = toFtsQuery(raw, 'and');
  if (!and) return [];
  const or = toFtsQuery(raw, 'or');
  return or && or !== and ? [and, or] : [and];
}
