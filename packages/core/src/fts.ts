import { isPostgres, type Client } from '@bufferoverride/db';

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

/**
 * The same tokens as a Postgres tsquery: every token single-quoted (so `c++`,
 * `node.js` and `#pragma` stay one lexeme and no tsquery operator can slip in)
 * and joined with `&` or `|`. Null when nothing searchable remains.
 */
export function toTsQuery(raw: string, mode: 'and' | 'or' = 'and'): string | null {
  const tokens = (raw ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_.+#]+/)
    .map((t) => t.replace(/^[.+#]+|[.+#]+$/g, ''))
    .filter((t) => t.length > 0 && t.length <= 64)
    .slice(0, 16);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `'${t.replace(/'/g, "''")}'`).join(mode === 'and' ? ' & ' : ' | ');
}

/** One attempt at a question search: the FROM, WHERE and ORDER BY pieces and their arguments. */
export interface SearchClause {
  /** `questions` aliased `q`, joined to the search index where the database needs one. */
  from: string;
  where: string;
  orderBy: string;
  args: string[];
}

/**
 * Question search for whichever database is connected, as SQL fragments the
 * caller composes with its own columns, visibility predicate and limit:
 *
 *   select q.code, ... from ${c.from} where ${c.where} and ${visible('q')} order by ${c.orderBy} limit ?
 *
 * SQLite keeps the FTS5 table `questions_fts` (joined on its rowid, ranked by
 * bm25). Postgres has a generated tsvector column `questions.search` with a
 * GIN index (packages/db/migrations-pg/0001_core.sql), ranked by ts_rank_cd.
 * `mode: 'both'` is the AND-then-OR plan of `ftsAttempts`; `'or'` is recall
 * only, for duplicate suggestions.
 */
export function searchAttempts(client: Client, raw: string, mode: 'both' | 'or' = 'both'): SearchClause[] {
  if (isPostgres(client)) {
    const queries = mode === 'or' ? [toTsQuery(raw, 'or')] : [toTsQuery(raw, 'and'), toTsQuery(raw, 'or')];
    const unique = [...new Set(queries.filter((q): q is string => q !== null))];
    return unique.map((q) => ({
      from: 'questions q',
      where: "q.search @@ to_tsquery('english', ?)",
      orderBy: "ts_rank_cd(q.search, to_tsquery('english', ?)) desc",
      args: [q, q],
    }));
  }
  const matches = mode === 'or' ? [toFtsQuery(raw, 'or')].filter((m): m is string => m !== null) : ftsAttempts(raw);
  return matches.map((match) => ({
    from: 'questions_fts f join questions q on q.id = f.rowid',
    where: 'questions_fts match ?',
    orderBy: 'bm25(questions_fts)',
    args: [match],
  }));
}
