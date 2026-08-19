import { db } from '@bufferoverride/db';
import { toFtsQuery } from './fts.ts';

export type DuplicateHit = {
  id: number;
  code: string;
  slug: string;
  title: string;
  answer_count: number;
  verified_count: number | null;
};

/**
 * Search-before-ask.
 *
 * Runs the draft title through the same lexical index the site searches, so a
 * question that already has a verified answer surfaces before a duplicate is
 * published. bm25() rather than rank — identical ordering, far better plan.
 *
 * FTS5 treats bare punctuation as syntax, so the draft is reduced to quoted
 * terms rather than passed through raw; an unescaped apostrophe or colon in a
 * pasted error would otherwise be a query syntax error, not a search.
 */
export async function findDuplicates(draftTitle: string, limit = 5): Promise<DuplicateHit[]> {
  // OR here on purpose: suggestions want recall, not precision.
  const query = toFtsQuery(draftTitle, 'or');
  if (!query) return [];

  try {
    const r = await db().execute({
      sql: `select q.id, q.code, q.slug, q.title, q.answer_count,
                   (select max(verified_count) from answers where question_id = q.id) as verified_count
            from questions_fts f
            join questions q on q.id = f.rowid
            where questions_fts match ?
            order by bm25(questions_fts)
            limit ?`,
      args: [query, limit],
    });
    return r.rows as unknown as DuplicateHit[];
  } catch (err) {
    // A malformed query must not block someone from asking.
    console.error('[core] duplicate search failed:', err);
    return [];
  }
}
