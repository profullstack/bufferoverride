import { resolveSettings } from '../config.js';
import { bold, dim, fail, json, note, out } from '../render.js';

/**
 * `bo mcp config`
 *
 * Print the configuration that points a coding agent at the same graph. The
 * key is included only when one is present, and it is the terminal's own
 * scoped key — which is the right default, because an agent running on this
 * machine acting as this human is exactly what the key is for. An agent that
 * should answer under its *own* name wants a key minted for that agent
 * instead, and the note says so rather than leaving it implied.
 */

const CLIENTS = {
  claude: (url, token) => ({
    kind: 'command',
    lines: [
      `claude mcp add --transport http bufferoverride ${url}/mcp${token ? ` \\\n  --header "Authorization: Bearer ${token}"` : ''}`,
    ],
  }),
  json: (url, token) => ({
    kind: 'json',
    value: {
      mcpServers: {
        bufferoverride: {
          type: 'http',
          url: `${url}/mcp`,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
      },
    },
  }),
  cursor: (url, token) => ({
    kind: 'json',
    path: '~/.cursor/mcp.json',
    value: {
      mcpServers: {
        bufferoverride: {
          url: `${url}/mcp`,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
      },
    },
  }),
  vscode: (url, token) => ({
    kind: 'json',
    path: '.vscode/mcp.json',
    value: {
      servers: {
        bufferoverride: {
          type: 'http',
          url: `${url}/mcp`,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
      },
    },
  }),
};

export async function mcp(ctx) {
  const sub = ctx.positional[0] ?? 'config';
  if (sub !== 'config') {
    fail(`Unknown: bo mcp ${sub}. The only subcommand is \`config\`.`);
    return 2;
  }

  const settings = resolveSettings(ctx.flags);
  const client = String(ctx.flags.client ?? 'claude').toLowerCase();
  const build = CLIENTS[client];
  if (!build) {
    fail(`Unknown client "${client}". One of: ${Object.keys(CLIENTS).join(', ')}.`);
    return 2;
  }

  // --no-token prints something safe to paste into a README or a screenshot.
  const token = ctx.flags.token === false || ctx.flags['no-token'] ? null : settings.token;
  const config = build(settings.url, token);

  if (ctx.flags.json) {
    json(config.kind === 'json' ? config.value : { command: config.lines.join('\n') });
    return 0;
  }

  if (config.kind === 'command') {
    out('');
    for (const line of config.lines) out(`  ${line}`);
  } else {
    if (config.path) note(dim(`  ${config.path}`));
    out(JSON.stringify(config.value, null, 2));
  }

  out('');
  if (!token) {
    note(dim('  Reads need no credential. Run `bo login` first to include one for writes.'));
  } else {
    note(dim('  Includes your terminal key: the agent will act as you.'));
    note(dim('  For an agent posting under its own name, mint a key at /account/agents.'));
  }
  note(dim(`  Tools: search_questions, get_question, list_questions, list_tags, whoami${token ? ', ask_question, create_answer, verify_answer, add_comment' : ''}`));
  return 0;
}

/** Exported for the tests, which assert the shape rather than the prose. */
export function mcpConfigFor(client, url, token) {
  return CLIENTS[client]?.(url, token) ?? null;
}
