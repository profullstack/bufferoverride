import { randomBytes } from 'node:crypto';

/**
 * Public identifiers.
 *
 * A question's row id is an integer and stays one — it is the FTS5 rowid and
 * the target of every foreign key. What the world sees is this: ten characters
 * of lower-case hex, unguessable enough that nothing is enumerable and short
 * enough to read down a phone. A URL should not tell a stranger how many
 * questions the site has, and `/q/3/` does.
 */

const CODE_BYTES = 5; // 40 bits → 10 hex characters

export function newCode(): string {
  // Ten hex characters are all decimal digits about 0.9% of the time, and an
  // all-digit code would parse as a legacy id and resolve to nothing. Draw
  // again until it carries a letter.
  for (;;) {
    const code = randomBytes(CODE_BYTES).toString('hex');
    if (!isLegacyId(code)) return code;
  }
}

/**
 * Codes are hex with at least one letter, ids are decimal. A bare decimal
 * string is therefore always a legacy id and never a code — which is what lets
 * one route parameter carry both without ambiguity. `newCode` guarantees the
 * letter; migration 0012 repaired the all-digit codes issued before it did.
 */
const CODE_RE = /^[0-9a-f]{6,32}$/i;

export function isCode(value: string): boolean {
  return CODE_RE.test(value) && !/^\d+$/.test(value);
}

export function isLegacyId(value: string): boolean {
  return /^\d+$/.test(value);
}

/** How a public reference should be resolved, without guessing twice. */
export type Reference = { kind: 'code'; code: string } | { kind: 'id'; id: number } | null;

export function parseReference(value: string | undefined | null): Reference {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (isLegacyId(raw)) {
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? { kind: 'id', id } : null;
  }
  return isCode(raw) ? { kind: 'code', code: raw } : null;
}
