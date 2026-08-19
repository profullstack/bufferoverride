import { Hono } from 'hono';
import { db, env } from '@bufferoverride/db';
import { areIndependent, principalFromAuthHeader, type Scope } from '@bufferoverride/auth';
import { scanSecrets, validateAnswer } from '@bufferoverride/core';

export const mcp = new Hono();

const PROTOCOL_VERSION = '2025-06-18';

/**
 * Read-only MCP tools.
 *
 * Everything returned here is community content and must reach the caller as
 * data. Results are structured fields rather than prose an agent might read as
 * instructions, and no tool mutates anything — writes need scoped credentials
 * that this endpoint deliberately does not accept yet.
 */
const WRITE_TOOLS = [
  {
    name: 'create_answer',
    scope: 'write:answers' as Scope,
    description:
      'Publish an answer to a question. Declare the version range it is valid for; an answer that does not say what it applies to cannot go stale honestly.',
    inputSchema: {
      type: 'object',
      properties: {
        question_id: { type: 'integer' },
        body: { type: 'string', description: 'Why it works, not only what to type.' },
        valid_from: { type: 'string', description: 'e.g. "bun 1.1"' },
        valid_through: { type: 'string', description: 'e.g. "bun 1.3"' },
      },
      required: ['question_id', 'body'],
    },
  },
  {
    name: 'verify_answer',
    scope: 'write:verifications' as Scope,
    description:
      'Record a reproduction of an answer in your own environment. Independence is computed from ownership, not claimed: a run by the answer author, or by another agent under the same owner, is recorded but does not count.',
    inputSchema: {
      type: 'object',
      properties: {
        answer_id: { type: 'integer' },
        result: { type: 'string', enum: ['pass', 'fail', 'partial'] },
        environment: { type: 'string', description: 'Required. What you actually ran it on.' },
        notes: { type: 'string' },
      },
      required: ['answer_id', 'result', 'environment'],
    },
  },
];

const TOOLS = [
  {
    name: 'search_questions',
    description:
      'Full-text search over public questions. Returns matches ranked by relevance with their verification state and version validity.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Error text or keywords to search for.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_question',
    description:
      'Fetch one question with its answers, the version range each answer is valid for, and how many independent actors reproduced it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'Question id.' } },
      required: ['id'],
    },
  },
  {
    name: 'list_tags',
    description: 'List tags with the number of questions carrying each.',
    inputSchema: { type: 'object', properties: {} },
  },
];

type Caller = { actorId: string; scopes: Scope[] } | null;

async function runTool(name: string, args: Record<string, unknown>, caller: Caller) {
  const base = env('PUBLIC_BASE_URL') ?? 'https://bufferoverride.com';

  if (name === 'create_answer' || name === 'verify_answer') {
    const tool = WRITE_TOOLS.find((t) => t.name === name)!;
    if (!caller) throw new Error('This tool needs an API key. See /docs/mcp.');
    if (!caller.scopes.includes(tool.scope)) throw new Error(`This key lacks the ${tool.scope} scope.`);
  }

  if (name === 'create_answer') {
    const questionId = Number(args.question_id);
    const body = String(args.body ?? '').trim();
    const invalid = validateAnswer(body);
    if (invalid.length) throw new Error(invalid[0].message);

    // An agent cannot publish a credential through the back door either.
    const findings = scanSecrets(body);
    if (findings.length) throw new Error(`Refused: the answer contains ${findings[0].kind}.`);

    const exists = await db().execute({ sql: 'select id from questions where id = ?', args: [questionId] });
    if (!exists.rows.length) throw new Error(`no question ${questionId}`);

    const inserted = await db().execute({
      sql: `insert into answers (question_id, author_id, attribution, body, valid_from, valid_through)
            values (?, ?, 'agent', ?, ?, ?) returning id`,
      args: [
        questionId,
        caller!.actorId,
        body,
        args.valid_from ? String(args.valid_from) : null,
        args.valid_through ? String(args.valid_through) : null,
      ],
    });
    const id = Number((inserted.rows[0] as unknown as { id: number }).id);

    await db().batch(
      [
        {
          sql: `insert into revisions (content_type, content_id, actor_id, body, comment)
                values ('answer', ?, ?, ?, 'created via mcp')`,
          args: [id, caller!.actorId, body],
        },
        {
          sql: `update questions set answer_count = (select count(*) from answers where question_id = ?),
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = ?`,
          args: [questionId, questionId],
        },
        {
          sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
                values (?, 'answer.create', 'answer', ?, '{"via":"mcp"}')`,
          args: [caller!.actorId, String(id)],
        },
      ] as never,
      'write',
    );

    return { answer_id: id, url: `${base}/q/${questionId}#answer-${id}` };
  }

  if (name === 'verify_answer') {
    const answerId = Number(args.answer_id);
    const result = String(args.result ?? '');
    const environment = String(args.environment ?? '').trim();
    if (!['pass', 'fail', 'partial'].includes(result)) throw new Error('result must be pass, fail or partial');
    if (environment.length < 3) throw new Error('environment is required — a verification without one proves nothing');

    const answer = await db().execute({ sql: 'select author_id from answers where id = ?', args: [answerId] });
    if (!answer.rows.length) throw new Error(`no answer ${answerId}`);
    const authorId = (answer.rows[0] as unknown as { author_id: string }).author_id;
    const independent = (await areIndependent(caller!.actorId, authorId)) ? 1 : 0;

    await db().batch(
      [
        {
          sql: `insert into verifications (answer_id, actor_id, result, method, environment, output_summary, is_independent)
                values (?, ?, ?, 'automated', ?, ?, ?)`,
          args: [answerId, caller!.actorId, result, environment, String(args.notes ?? '').slice(0, 2000) || null, independent],
        },
        {
          sql: `update answers set verified_count = (
                  select count(*) from verifications where answer_id = ? and result = 'pass' and is_independent = 1
                ) where id = ?`,
          args: [answerId, answerId],
        },
        {
          sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
                values (?, 'verification.create', 'answer', ?, '{"via":"mcp"}')`,
          args: [caller!.actorId, String(answerId)],
        },
      ] as never,
      'write',
    );

    return {
      answer_id: answerId,
      result,
      counted: independent === 1,
      note: independent === 1 ? 'Counted as an independent reproduction.' : 'Recorded, but not counted: you are not independent of the author.',
    };
  }


  if (name === 'search_questions') {
    const query = String(args.query ?? '').trim();
    if (!query) throw new Error('query is required');
    const limit = Math.min(Number(args.limit ?? 10), 50);
    const r = await db().execute({
      sql: `select q.id, q.slug, q.title, q.answer_count,
                   (select max(verified_count) from answers where question_id = q.id) as verified
            from questions_fts f join questions q on q.id = f.rowid
            where questions_fts match ? and q.is_hidden = 0
            order by bm25(questions_fts) limit ?`,
      args: [query, limit],
    });
    return {
      query,
      count: r.rows.length,
      results: r.rows.map((row) => ({
        ...(row as Record<string, unknown>),
        url: `${base}/q/${row.id}/${row.slug}`,
      })),
    };
  }

  if (name === 'get_question') {
    const id = Number(args.id);
    const q = await db().execute({
      sql: `select q.id, q.slug, q.title, q.body, q.created_at, a.username as author
            from questions q left join actors a on a.id = q.author_id
            where q.id = ? and q.is_hidden = 0`,
      args: [id],
    });
    if (!q.rows.length) throw new Error(`no question ${id}`);
    const answers = await db().execute({
      sql: `select ans.id, ans.body, ans.is_accepted, ans.verified_count, ans.valid_from,
                   ans.valid_through, ans.is_stale, ans.attribution, a.username as author
            from answers ans left join actors a on a.id = ans.author_id
            where ans.question_id = ? and ans.is_hidden = 0
            order by ans.is_stale asc, ans.is_accepted desc, ans.verified_count desc`,
      args: [id],
    });
    const row = q.rows[0] as Record<string, unknown>;
    return {
      question: { ...row, url: `${base}/q/${row.id}/${row.slug}` },
      answers: answers.rows,
      note: 'verified_count counts independent reproductions only.',
    };
  }

  if (name === 'list_tags') {
    const r = await db().execute(
      'select slug, name, question_count from tags order by question_count desc, slug limit 200',
    );
    return { tags: r.rows };
  }

  throw new Error(`unknown tool: ${name}`);
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// A browser hitting /mcp should learn what it is rather than see a 404.
mcp.get('/mcp', (c) =>
  c.json({
    name: 'bufferoverride',
    protocolVersion: PROTOCOL_VERSION,
    transport: 'streamable-http (JSON-RPC over POST)',
    tools: TOOLS.map((t) => t.name),
    writeTools: WRITE_TOOLS.map((t) => ({ name: t.name, requiresScope: t.scope })),
    documentation: `${env('PUBLIC_BASE_URL') ?? ''}/docs/mcp`,
  }),
);

mcp.post('/mcp', async (c) => {
  const body = await c.req.json<{ id?: unknown; method?: string; params?: Record<string, unknown> }>()
    .catch(() => null);
  if (!body || typeof body.method !== 'string') {
    return c.json(rpcError(null, -32600, 'Invalid Request'), 400);
  }
  const { id, method, params } = body;

  const principal = await principalFromAuthHeader(c.req.header('authorization'));
  const caller: Caller = principal ? { actorId: principal.actor.id, scopes: principal.scopes } : null;

  try {
    if (method === 'initialize') {
      return c.json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'bufferoverride', version: '0.1.0' },
        }),
      );
    }
    if (method === 'notifications/initialized') return c.body(null, 204);
    if (method === 'ping') return c.json(rpcResult(id, {}));
    if (method === 'tools/list') {
      // A caller only sees the write tools its key can actually use, so an
      // agent is never offered a capability it will be refused.
      const granted = WRITE_TOOLS.filter((t) => caller?.scopes.includes(t.scope)).map(
        ({ scope, ...rest }) => rest,
      );
      return c.json(rpcResult(id, { tools: [...TOOLS, ...granted] }));
    }

    if (method === 'tools/call') {
      const name = String(params?.name ?? '');
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const data = await runTool(name, args, caller);
      return c.json(
        rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        }),
      );
    }

    return c.json(rpcError(id, -32601, `Method not found: ${method}`), 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal error';
    return c.json(rpcResult(id, { isError: true, content: [{ type: 'text', text: message }] }));
  }
});
