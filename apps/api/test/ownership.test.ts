import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// A file-backed libSQL database, pointed at before anything opens a client.
// `db()` is lazy, so setting these here is enough — but they must be set before
// the first call, not before the first import.
const dir = mkdtempSync(join(tmpdir(), 'bo-ownership-'));
process.env.TURSO_DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.TURSO_AUTH_TOKEN = 'not-used-for-a-file-url';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';

const { db, migrate, visible } = await import('@bufferoverride/db');
const { createSession, createApiKey } = await import('@bufferoverride/auth');
const { publishQuestion, publishAnswer } = await import('../src/publish.ts');
const { write } = await import('../src/write.ts');
const { mcp } = await import('../src/mcp.ts');

/**
 * What these cover.
 *
 * One rule is worth more than every other line in the edit path: you may change
 * your own content and nobody else's. It is enforced in one place, but reached
 * from three doors and drawn by a fourth, so the matrix is tested against the
 * HTTP surface rather than the function — a handler wired to the wrong scope,
 * or one that forgets to pass `viaKey`, is exactly the mistake a unit test on
 * `editQuestion` would sail past.
 */

const alice = 'act_alice';
const bob = 'act_bob';
const agent = 'agt_alices_agent';

let aliceSession = '';
let bobSession = '';
let agentKey = '';
let questionCode = '';
let questionId = 0;
let bobAnswerId = 0;
let agentAnswerId = 0;
let bobCommentId = 0;

function as(token: string) {
  return { cookie: `bo_session=${token}`, 'content-type': 'application/json' };
}

function withKey(token: string) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function patch(path: string, headers: Record<string, string>, body: unknown) {
  return write.request(path, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

async function remove(path: string, headers: Record<string, string>) {
  return write.request(path, { method: 'DELETE', headers });
}

before(async () => {
  await migrate();

  await db().batch(
    [
      {
        sql: `insert into actors (id, kind, username, display_name) values (?, 'human', 'alice', 'Alice')`,
        args: [alice],
      },
      {
        sql: `insert into actors (id, kind, username, display_name) values (?, 'human', 'bob', 'Bob')`,
        args: [bob],
      },
      {
        sql: `insert into actors (id, kind, username, display_name) values (?, 'agent', 'alicebot', 'Alicebot')`,
        args: [agent],
      },
      { sql: 'insert into agent_owners (agent_id, owner_id) values (?, ?)', args: [agent, alice] },
    ] as never,
    'write',
  );

  aliceSession = await createSession(alice);
  bobSession = await createSession(bob);
  agentKey = (
    await createApiKey({
      actorId: agent,
      createdBy: alice,
      name: 'test key',
      scopes: ['read', 'write:questions', 'write:answers', 'write:comments'],
    })
  ).token;

  const q = await publishQuestion({
    actorId: alice,
    title: 'Why does the client open a handle at module scope',
    body: 'Expected a lazy connection, got one at import time. Node 24, libsql 0.15.',
    tags: ['node', 'libsql'],
  });
  questionCode = q.code;
  questionId = q.id;

  bobAnswerId = (
    await publishAnswer({ actorId: bob, question: questionCode, body: 'Because the module runs its factory eagerly.' })
  ).id;
  agentAnswerId = (
    await publishAnswer({ actorId: agent, question: questionCode, body: 'Defer it behind a getter and it stops.' })
  ).id;

  const c = await db().execute({
    sql: `insert into comments (content_type, content_id, author_id, body)
          values ('question', ?, ?, 'Which libsql version exactly?') returning id`,
    args: [questionId, bob],
  });
  bobCommentId = Number((c.rows[0] as unknown as { id: number }).id);
});

after(() => {
  // The temp directory goes with the OS; nothing here outlives the run.
});

describe('editing your own content', () => {
  it('lets the author revise their question', async () => {
    const res = await patch(`/v1/questions/${questionCode}`, as(aliceSession), {
      title: 'Why does the libSQL client open a handle at module scope',
      tags: ['node', 'libsql', 'turso'],
    });
    assert.equal(res.status, 200);

    const row = await db().execute({
      sql: 'select title, body, slug, edited_at from questions where id = ?',
      args: [questionId],
    });
    const q = row.rows[0] as unknown as { title: string; body: string; slug: string; edited_at: string };
    assert.match(q.title, /libSQL client/);
    // An omitted field keeps its stored value rather than being cleared.
    assert.match(q.body, /Expected a lazy connection/);
    assert.match(q.slug, /libsql-client/);
    assert.ok(q.edited_at, 'edited_at is stamped');
  });

  it('records the revision rather than overwriting history', async () => {
    const r = await db().execute({
      sql: `select comment from revisions where content_type = 'question' and content_id = ?
            order by created_at`,
      args: [questionId],
    });
    const comments = r.rows.map((row) => (row as unknown as { comment: string }).comment);
    assert.deepEqual(comments, ['created', 'edited']);
  });

  it('lets the author revise their answer', async () => {
    const res = await patch(`/v1/answers/${bobAnswerId}`, as(bobSession), {
      body: 'Because the module runs its factory eagerly, at import rather than at first use.',
      validFrom: 'libsql 0.15',
    });
    assert.equal(res.status, 200);
    const row = await db().execute({
      sql: 'select body, valid_from from answers where id = ?',
      args: [bobAnswerId],
    });
    const a = row.rows[0] as unknown as { body: string; valid_from: string };
    assert.match(a.body, /at first use/);
    assert.equal(a.valid_from, 'libsql 0.15');
  });

  it('lets the author revise their comment', async () => {
    const res = await patch(`/v1/comments/${bobCommentId}`, as(bobSession), {
      body: 'Which libsql version exactly? 0.14 behaved differently.',
    });
    assert.equal(res.status, 200);
  });
});

describe('editing someone else’s content', () => {
  it('refuses a question that is not yours', async () => {
    const res = await patch(`/v1/questions/${questionCode}`, as(bobSession), { title: 'Bob was here' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'not_the_author');

    const row = await db().execute({ sql: 'select title from questions where id = ?', args: [questionId] });
    assert.doesNotMatch((row.rows[0] as unknown as { title: string }).title, /Bob was here/);
  });

  it('refuses an answer that is not yours', async () => {
    const res = await patch(`/v1/answers/${bobAnswerId}`, as(aliceSession), { body: 'Rewritten by the asker.' });
    assert.equal(res.status, 403);
  });

  it('refuses a comment that is not yours', async () => {
    const res = await patch(`/v1/comments/${bobCommentId}`, as(aliceSession), { body: 'nope' });
    assert.equal(res.status, 403);
  });

  it('refuses deleting content that is not yours', async () => {
    assert.equal((await remove(`/v1/answers/${bobAnswerId}`, as(aliceSession))).status, 403);
    assert.equal((await remove(`/v1/comments/${bobCommentId}`, as(aliceSession))).status, 403);
    const row = await db().execute({ sql: 'select is_deleted from answers where id = ?', args: [bobAnswerId] });
    assert.equal(Number((row.rows[0] as unknown as { is_deleted: number }).is_deleted), 0);
  });

  it('refuses an anonymous edit outright', async () => {
    const res = await patch(`/v1/questions/${questionCode}`, { 'content-type': 'application/json' }, {
      title: 'Anonymous rewrite',
    });
    assert.equal(res.status, 401);
  });
});

describe('agents and their owners', () => {
  it('lets an owner revise their own agent’s answer', async () => {
    const res = await patch(`/v1/answers/${agentAnswerId}`, as(aliceSession), {
      body: 'Defer it behind a getter and the handle opens at first query instead.',
    });
    assert.equal(res.status, 200);
  });

  it('does not let a key reach past its own actor', async () => {
    // The key belongs to Alice's agent. Its owner may edit Alice's question;
    // the key must not inherit that, or one agent credential becomes a lever on
    // everything its owner wrote.
    const res = await patch(`/v1/questions/${questionCode}`, withKey(agentKey), { title: 'Key rewrite' });
    assert.equal(res.status, 403);
  });

  it('lets a key revise what that same actor wrote', async () => {
    const res = await patch(`/v1/answers/${agentAnswerId}`, withKey(agentKey), {
      body: 'Defer it behind a getter; the handle then opens at the first query.',
    });
    assert.equal(res.status, 200);
  });

  it('refuses a key without the matching scope', async () => {
    const readOnly = (
      await createApiKey({ actorId: agent, createdBy: alice, name: 'read only', scopes: ['read'] })
    ).token;
    const res = await patch(`/v1/answers/${agentAnswerId}`, withKey(readOnly), { body: 'x'.repeat(40) });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'insufficient_scope');
  });
});

describe('the MCP door', () => {
  async function rpc(method: string, params: unknown, token?: string) {
    const res = await mcp.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (await res.json()) as { result?: Record<string, unknown> };
  }

  it('advertises the edit tools a key can actually use', async () => {
    const listed = await rpc('tools/list', {}, agentKey);
    const names = (listed.result?.tools as { name: string }[]).map((t) => t.name);
    assert.ok(names.includes('edit_answer'));
    assert.ok(names.includes('delete_answer'));

    const readOnly = (
      await createApiKey({ actorId: agent, createdBy: alice, name: 'reader', scopes: ['read'] })
    ).token;
    const limited = await rpc('tools/list', {}, readOnly);
    const limitedNames = (limited.result?.tools as { name: string }[]).map((t) => t.name);
    assert.ok(!limitedNames.some((n) => n.startsWith('edit_') || n.startsWith('delete_')));
  });

  it('refuses to edit an answer the key did not write', async () => {
    const called = await rpc(
      'tools/call',
      { name: 'edit_answer', arguments: { answer_id: bobAnswerId, body: 'x'.repeat(40) } },
      agentKey,
    );
    assert.equal(called.result?.isError, true);
    const text = (called.result?.content as { text: string }[])[0].text;
    assert.match(text, /only edit or delete your own/);
  });

  it('edits the key’s own answer', async () => {
    const called = await rpc(
      'tools/call',
      {
        name: 'edit_answer',
        arguments: { answer_id: agentAnswerId, body: 'Defer the client behind a getter and it opens lazily.' },
      },
      agentKey,
    );
    assert.notEqual(called.result?.isError, true);
    const row = await db().execute({ sql: 'select body from answers where id = ?', args: [agentAnswerId] });
    assert.match((row.rows[0] as unknown as { body: string }).body, /opens lazily/);
  });
});

describe('deleting', () => {
  it('refuses to delete a question others have answered', async () => {
    const res = await remove(`/v1/questions/${questionCode}`, as(aliceSession));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'has_other_answers');
  });

  it('withdraws an answer and reopens acceptance', async () => {
    await db().execute({
      sql: 'update answers set is_accepted = 1 where id = ?',
      args: [bobAnswerId],
    });
    await db().execute({
      sql: 'update questions set accepted_answer_id = ? where id = ?',
      args: [bobAnswerId, questionId],
    });

    const res = await remove(`/v1/answers/${bobAnswerId}`, as(bobSession));
    assert.equal(res.status, 200);

    const a = await db().execute({
      sql: 'select is_deleted, deleted_at, is_accepted from answers where id = ?',
      args: [bobAnswerId],
    });
    const row = a.rows[0] as unknown as { is_deleted: number; deleted_at: string; is_accepted: number };
    assert.equal(Number(row.is_deleted), 1);
    assert.ok(row.deleted_at);
    assert.equal(Number(row.is_accepted), 0);

    const q = await db().execute({
      sql: 'select accepted_answer_id, answer_count from questions where id = ?',
      args: [questionId],
    });
    const question = q.rows[0] as unknown as { accepted_answer_id: number | null; answer_count: number };
    assert.equal(question.accepted_answer_id, null);
    assert.equal(Number(question.answer_count), 1, 'the withdrawn answer stops counting');
  });

  it('keeps the row, its revisions and its audit trail', async () => {
    const revisions = await db().execute({
      sql: `select count(*) as n from revisions where content_type = 'answer' and content_id = ?`,
      args: [bobAnswerId],
    });
    assert.ok(Number((revisions.rows[0] as unknown as { n: number }).n) > 0);

    const audit = await db().execute({
      sql: `select count(*) as n from audit_events where action = 'answer.delete' and target_id = ?`,
      args: [String(bobAnswerId)],
    });
    assert.equal(Number((audit.rows[0] as unknown as { n: number }).n), 1);
  });

  it('hides withdrawn content from every public read', async () => {
    const answers = await db().execute({
      sql: `select id from answers where question_id = ? and ${visible('answers')}`,
      args: [questionId],
    });
    assert.deepEqual(
      answers.rows.map((r) => Number((r as unknown as { id: number }).id)),
      [agentAnswerId],
    );
  });

  it('withdraws a comment', async () => {
    assert.equal((await remove(`/v1/comments/${bobCommentId}`, as(bobSession))).status, 200);
    const c = await db().execute({
      sql: 'select is_deleted from comments where id = ?',
      args: [bobCommentId],
    });
    assert.equal(Number((c.rows[0] as unknown as { is_deleted: number }).is_deleted), 1);
  });

  it('lets the asker withdraw once only their own answers remain', async () => {
    const res = await remove(`/v1/questions/${questionCode}`, as(aliceSession));
    assert.equal(res.status, 200);

    const q = await db().execute({
      sql: `select id from questions where id = ? and ${visible('questions')}`,
      args: [questionId],
    });
    assert.equal(q.rows.length, 0, 'the question is gone from public reads');

    const remaining = await db().execute({
      sql: `select id from answers where question_id = ? and ${visible('answers')}`,
      args: [questionId],
    });
    assert.equal(remaining.rows.length, 0, 'its remaining answers go with it');
  });

  it('reads a withdrawn item as absent, not as forbidden', async () => {
    const res = await patch(`/v1/questions/${questionCode}`, as(aliceSession), { title: 'still here?' });
    assert.equal(res.status, 404);
  });
});
