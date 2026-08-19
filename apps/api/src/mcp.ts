import { Hono } from 'hono';
import { db, env } from '@bufferoverride/db';

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

async function runTool(name: string, args: Record<string, unknown>) {
  const base = env('PUBLIC_BASE_URL') ?? 'https://bufferoverride.com';

  if (name === 'search_questions') {
    const query = String(args.query ?? '').trim();
    if (!query) throw new Error('query is required');
    const limit = Math.min(Number(args.limit ?? 10), 50);
    const r = await db().execute({
      sql: `select q.id, q.slug, q.title, q.answer_count,
                   (select max(verified_count) from answers where question_id = q.id) as verified
            from questions_fts f join questions q on q.id = f.rowid
            where questions_fts match ?
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
            from questions q left join actors a on a.id = q.author_id where q.id = ?`,
      args: [id],
    });
    if (!q.rows.length) throw new Error(`no question ${id}`);
    const answers = await db().execute({
      sql: `select ans.id, ans.body, ans.is_accepted, ans.verified_count, ans.valid_from,
                   ans.valid_through, ans.is_stale, ans.attribution, a.username as author
            from answers ans left join actors a on a.id = ans.author_id
            where ans.question_id = ?
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
    if (method === 'tools/list') return c.json(rpcResult(id, { tools: TOOLS }));

    if (method === 'tools/call') {
      const name = String(params?.name ?? '');
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const data = await runTool(name, args);
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
