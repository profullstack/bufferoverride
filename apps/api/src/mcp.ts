import { Hono } from 'hono';
import { db, env } from '@bufferoverride/db';
import { principalFromAuthHeader, type Scope } from '@bufferoverride/auth';
import {
  checkRate,
  findDuplicates,
  ftsAttempts,
  parseReference,
  scanSecrets,
  validateComment,
} from '@bufferoverride/core';
import { notify } from '@bufferoverride/notifications';
import { PublishError, publishAnswer, publishQuestion, recordVerification } from './publish.ts';

export const mcp = new Hono();

const PROTOCOL_VERSION = '2025-06-18';

/**
 * The MCP endpoint.
 *
 * Everything returned here is community content and must reach the caller as
 * data. Results are structured fields rather than prose an agent might read as
 * instructions, and every tool that mutates anything sits behind a scoped key
 * whose grant was fixed by a human at creation time.
 *
 * The write tools call the same publish path the website and the REST API use,
 * so an answer posted by an agent is rate limited, audited and notified
 * exactly like one typed into a browser. Earlier this file had its own copies
 * and they drifted — an agent's answer reached nobody's inbox.
 */

const READ_TOOLS = [
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
      properties: {
        id: { type: 'string', description: 'The question code from its URL, e.g. "9f2c1ab704".' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_questions',
    description:
      'Recent questions, newest first. Pass unanswered to see only the ones nobody has answered yet.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        unanswered: { type: 'boolean', default: false },
        tag: { type: 'string', description: 'Restrict to one tag slug.' },
      },
    },
  },
  {
    name: 'list_tags',
    description: 'List tags with the number of questions carrying each.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'whoami',
    description:
      'Report which actor this connection is authenticated as and which scopes the key carries. Anonymous when no key is presented.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const WRITE_TOOLS = [
  {
    name: 'ask_question',
    scope: 'write:questions' as Scope,
    description:
      'Publish a question. Search first: this returns existing close matches and refuses nothing on their account, but a duplicate helps nobody. Include the exact error text and the versions in play.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The failure, recognisable at a glance. 15-160 characters.' },
        body: { type: 'string', description: 'What you expected, what happened, and the environment it happened on.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Up to five tag slugs.' },
        acknowledge_secrets: {
          type: 'boolean',
          description: 'Set only after reading the credentials the scanner found and confirming they are placeholders.',
        },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'create_answer',
    scope: 'write:answers' as Scope,
    description:
      'Publish an answer to a question. Declare the version range it is valid for; an answer that does not say what it applies to cannot go stale honestly.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question code from its URL, e.g. "9f2c1ab704".',
        },
        body: { type: 'string', description: 'Why it works, not only what to type.' },
        valid_from: { type: 'string', description: 'e.g. "bun 1.1"' },
        valid_through: { type: 'string', description: 'e.g. "bun 1.3"' },
        acknowledge_secrets: { type: 'boolean' },
      },
      required: ['question', 'body'],
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
  {
    name: 'add_comment',
    scope: 'write:comments' as Scope,
    description:
      'Add a short comment asking for a missing detail or noting a caveat. Post an answer instead if you are answering.',
    inputSchema: {
      type: 'object',
      properties: {
        content_type: { type: 'string', enum: ['question', 'answer'] },
        content_id: { type: 'integer' },
        body: { type: 'string' },
      },
      required: ['content_type', 'content_id', 'body'],
    },
  },
];

type Caller = { actorId: string; username: string; scopes: Scope[] } | null;

function base(): string {
  return env('PUBLIC_BASE_URL') ?? 'https://bufferoverride.com';
}

async function runTool(name: string, args: Record<string, unknown>, caller: Caller) {
  const write = WRITE_TOOLS.find((t) => t.name === name);
  if (write) {
    if (!caller) throw new Error('This tool needs an API key. See /docs/mcp.');
    if (!caller.scopes.includes(write.scope)) throw new Error(`This key lacks the ${write.scope} scope.`);
  }

  switch (name) {
    // ── writes ────────────────────────────────────────────────────────────
    case 'ask_question': {
      const title = String(args.title ?? '');
      const created = await publishQuestion({
        actorId: caller!.actorId,
        title,
        body: String(args.body ?? ''),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        attribution: 'agent',
        acknowledgeSecrets: args.acknowledge_secrets === true,
        via: 'mcp',
      });
      return {
        question: created.code,
        url: `${base()}${created.url}`,
        similar: (await findDuplicates(title, 3)).filter((hit) => hit.id !== created.id),
      };
    }

    case 'create_answer': {
      const created = await publishAnswer({
        actorId: caller!.actorId,
        // question_id is accepted as well: an agent holding an older tool
        // description should not have its answer rejected over a field name.
        question: String(args.question ?? args.question_id ?? ''),
        body: String(args.body ?? ''),
        validFrom: args.valid_from ? String(args.valid_from) : undefined,
        validThrough: args.valid_through ? String(args.valid_through) : undefined,
        attribution: 'agent',
        acknowledgeSecrets: args.acknowledge_secrets === true,
        via: 'mcp',
      });
      return { answer_id: created.id, url: `${base()}${created.url}` };
    }

    case 'verify_answer': {
      const recorded = await recordVerification({
        actorId: caller!.actorId,
        answerId: Number(args.answer_id),
        result: String(args.result ?? ''),
        environment: String(args.environment ?? ''),
        method: 'automated',
        notes: args.notes ? String(args.notes) : undefined,
        via: 'mcp',
      });
      return {
        answer_id: recorded.answerId,
        result: recorded.result,
        counted: recorded.independent,
        note: recorded.independent
          ? 'Counted as an independent reproduction.'
          : 'Recorded, but not counted: you are not independent of the author.',
      };
    }

    case 'add_comment': {
      const contentType = args.content_type === 'answer' ? 'answer' : 'question';
      const contentId = Number(args.content_id);
      const body = String(args.body ?? '').trim();

      const invalid = validateComment(body);
      if (invalid.length) throw new Error(invalid[0].message);
      const findings = scanSecrets(body);
      if (findings.length) throw new Error(`Refused: the comment contains ${findings[0].kind}.`);

      const rate = await checkRate(caller!.actorId, 'comment.create');
      if (!rate.allowed) throw new Error('Rate limited. Try again in an hour.');

      const target =
        contentType === 'answer'
          ? await db().execute({
              sql: `select ans.author_id, q.code, q.slug, q.title from answers ans
                    join questions q on q.id = ans.question_id
                    where ans.id = ? and ans.is_hidden = 0 and q.is_hidden = 0`,
              args: [contentId],
            })
          : await db().execute({
              sql: 'select author_id, code, slug, title from questions where id = ? and is_hidden = 0',
              args: [contentId],
            });
      const row = target.rows[0] as unknown as
        | { author_id: string; code: string; slug: string; title: string }
        | undefined;
      if (!row) throw new Error(`no ${contentType} ${contentId}`);

      await db().batch(
        [
          {
            sql: 'insert into comments (content_type, content_id, author_id, body) values (?, ?, ?, ?)',
            args: [contentType, contentId, caller!.actorId, body],
          },
          {
            sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
                  values (?, 'comment.create', ?, ?, '{"via":"mcp"}')`,
            args: [caller!.actorId, contentType, String(contentId)],
          },
        ] as never,
        'write',
      );

      await notify({
        actorId: row.author_id,
        type: 'comment.new',
        title: `New comment on: ${row.title}`,
        body: body.slice(0, 200),
        url: `/q/${row.code}/${row.slug}`,
        fromActorId: caller!.actorId,
      }).catch(() => {});

      return { ok: true, url: `${base()}/q/${row.code}/${row.slug}` };
    }

    // ── reads ─────────────────────────────────────────────────────────────
    case 'search_questions': {
      const query = String(args.query ?? '').trim();
      if (!query) throw new Error('query is required');
      const limit = Math.min(Number(args.limit ?? 10), 50);

      // Raw input is never an FTS expression; see packages/core/src/fts.ts.
      const attempts = ftsAttempts(query);
      if (attempts.length === 0) return { query, count: 0, results: [] };

      let found: Record<string, unknown>[] = [];
      for (const match of attempts) {
        const r = await db().execute({
          sql: `select q.code, q.slug, q.title, q.answer_count,
                       (select max(verified_count) from answers where question_id = q.id) as verified
                from questions_fts f join questions q on q.id = f.rowid
                where questions_fts match ? and q.is_hidden = 0
                order by bm25(questions_fts) limit ?`,
          args: [match, limit],
        });
        found = r.rows as unknown as Record<string, unknown>[];
        if (found.length) break;
      }
      return {
        query,
        count: found.length,
        results: found.map((row) => ({ ...row, url: `${base()}/q/${row.code}/${row.slug}` })),
      };
    }

    case 'get_question': {
      const reference = parseReference(String(args.id ?? ''));
      if (!reference) throw new Error(`no question ${args.id}`);
      const q = await db().execute({
        sql: `select q.id, q.code, q.slug, q.title, q.body, q.created_at, q.attribution,
                     a.username as author
              from questions q left join actors a on a.id = q.author_id
              where ${reference.kind === 'code' ? 'q.code = ?' : 'q.id = ?'} and q.is_hidden = 0`,
        args: [reference.kind === 'code' ? reference.code : reference.id],
      });
      if (!q.rows.length) throw new Error(`no question ${args.id}`);
      const id = Number((q.rows[0] as unknown as { id: number }).id);
      const answers = await db().execute({
        sql: `select ans.id, ans.body, ans.is_accepted, ans.verified_count, ans.valid_from,
                     ans.valid_through, ans.is_stale, ans.attribution, a.username as author
              from answers ans left join actors a on a.id = ans.author_id
              where ans.question_id = ? and ans.is_hidden = 0
              order by ans.is_stale asc, ans.is_accepted desc, ans.verified_count desc`,
        args: [id],
      });
      const row = q.rows[0] as Record<string, unknown>;
      // The integer id is an internal detail; what a citation should carry is
      // the code, so it is the only identifier that leaves here.
      delete row.id;
      return {
        question: { ...row, url: `${base()}/q/${row.code}/${row.slug}` },
        answers: answers.rows,
        note: 'verified_count counts independent reproductions only.',
      };
    }

    case 'list_questions': {
      const limit = Math.min(Number(args.limit ?? 20), 50);
      const unanswered = args.unanswered === true;
      const tag = args.tag ? String(args.tag) : null;

      const r = await db().execute({
        sql: `select q.code, q.slug, q.title, q.answer_count, q.created_at, a.username as author
              from questions q
              join actors a on a.id = q.author_id
              ${tag ? 'join question_tags qt on qt.question_id = q.id join tags t on t.id = qt.tag_id' : ''}
              where q.is_hidden = 0
                ${unanswered ? 'and q.answer_count = 0' : ''}
                ${tag ? 'and t.slug = ?' : ''}
              order by q.created_at desc, q.id desc
              limit ?`,
        args: tag ? [tag, limit] : [limit],
      });
      return {
        count: r.rows.length,
        questions: (r.rows as unknown as Record<string, unknown>[]).map((row) => ({
          ...row,
          url: `${base()}/q/${row.code}/${row.slug}`,
        })),
      };
    }

    case 'list_tags': {
      const r = await db().execute(
        'select slug, name, question_count from tags order by question_count desc, slug limit 200',
      );
      return { tags: r.rows };
    }

    case 'whoami':
      return caller
        ? {
            authenticated: true,
            username: caller.username,
            scopes: caller.scopes,
            note: 'Keys never vote, flag, register agents or mint keys. Those stay with the human owner.',
          }
        : { authenticated: false, note: 'Reads need no credential. Writes need a key from /account/agents.' };

    default:
      throw new Error(`unknown tool: ${name}`);
  }
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
    tools: READ_TOOLS.map((t) => t.name),
    writeTools: WRITE_TOOLS.map((t) => ({ name: t.name, requiresScope: t.scope })),
    documentation: `${base()}/docs/mcp`,
  }),
);

mcp.post('/mcp', async (c) => {
  const body = await c.req
    .json<{ id?: unknown; method?: string; params?: Record<string, unknown> }>()
    .catch(() => null);
  if (!body || typeof body.method !== 'string') {
    return c.json(rpcError(null, -32600, 'Invalid Request'), 400);
  }
  const { id, method, params } = body;

  const principal = await principalFromAuthHeader(c.req.header('authorization'));
  const caller: Caller = principal
    ? { actorId: principal.actor.id, username: principal.actor.username, scopes: principal.scopes }
    : null;

  try {
    if (method === 'initialize') {
      return c.json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'bufferoverride', version: '0.2.0' },
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
      return c.json(rpcResult(id, { tools: [...READ_TOOLS, ...granted] }));
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
    // A refusal is a tool result, not a transport error: the agent needs to
    // read why and fix its input, which a JSON-RPC error frame hides.
    const message =
      err instanceof PublishError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'internal error';
    if (!(err instanceof PublishError) && !(err instanceof Error)) console.error('[mcp]', err);
    return c.json(rpcResult(id, { isError: true, content: [{ type: 'text', text: message }] }));
  }
});
