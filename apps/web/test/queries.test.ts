import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'bo-queries-'));
process.env.TURSO_DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.TURSO_AUTH_TOKEN = 'not-used-for-a-file-url';

const { db, migrate } = await import('@bufferoverride/db');
const { getQuestion, listQuestions, questionsByTag, searchQuestions } = await import(
  '../app/_lib/queries.ts'
);

/**
 * Every list query must return the column its links are built from.
 *
 * `code` replaced the row id in URLs, and the queries that were not updated did
 * not fail — they rendered `/q/undefined/<slug>`, a 404 on every question link
 * on every tag page and in every tag feed, live for a day. Nothing caught it:
 * raw libSQL rows arrive untyped and are cast straight to `QuestionRow`, so a
 * missing column is `undefined` at runtime and perfectly typed at compile time.
 *
 * These assertions are the compile-time check the cast throws away. A query
 * that forgets `code` fails here rather than in an URL.
 */

const author = 'act_author';
let code = '';

before(async () => {
  await migrate();
  await db().execute({
    sql: `insert into actors (id, kind, username, display_name) values (?, 'human', 'author', 'Author')`,
    args: [author],
  });

  const { publishQuestion } = await import('../../api/src/publish.ts');
  const q = await publishQuestion({
    actorId: author,
    title: 'Determining whether a domain is registered, at scale',
    body: 'RDAP rate limits before I get through the list. What actually scales here?',
    tags: ['networking', 'dns'],
  });
  code = q.code;
});

function assertAddressable(rows: { code: string; slug: string }[], where: string) {
  assert.ok(rows.length > 0, `${where} returned nothing to check`);
  for (const row of rows) {
    assert.ok(row.code, `${where} returned a row with no code — its links would be /q/undefined/…`);
    assert.notEqual(String(row.code), 'undefined', `${where} returned the string "undefined"`);
    assert.ok(row.slug, `${where} returned a row with no slug`);
  }
}

describe('every question list is addressable', () => {
  it('listQuestions', async () => {
    assertAddressable(await listQuestions(), 'listQuestions');
  });

  it('searchQuestions', async () => {
    assertAddressable(await searchQuestions('domain registered'), 'searchQuestions');
  });

  it('questionsByTag — the tag page and its feed share this one', async () => {
    assertAddressable(await questionsByTag('networking'), 'questionsByTag');
  });

  it('getQuestion resolves by the code a list handed out', async () => {
    const data = await getQuestion(code);
    assert.ok(data, 'a code from a list must resolve');
    assert.equal(data.question.code, code);
  });
});
