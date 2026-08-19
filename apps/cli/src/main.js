import { parseArgs } from './args.js';
import { VERSION } from './api.js';
import { bold, dim, fail, out, setColor } from './render.js';
import { login, logout, whoami } from './commands/login.js';
import { get, search } from './commands/read.js';
import { answer, ask, verify } from './commands/write.js';
import { run } from './commands/run.js';
import { mcp } from './commands/mcp.js';

const COMMANDS = {
  run: { fn: run, summary: 'Run a command, capture the failure, and find the existing answer' },
  search: { fn: search, summary: 'Search questions by error text' },
  get: { fn: get, summary: 'Read one question and its answers' },
  ask: { fn: ask, summary: 'Publish a question' },
  answer: { fn: answer, summary: 'Publish an answer' },
  verify: { fn: verify, summary: 'Record a reproduction of an answer' },
  login: { fn: login, summary: 'Sign this terminal in' },
  logout: { fn: logout, summary: 'Remove the local credential' },
  whoami: { fn: whoami, summary: 'Show who this terminal is acting as' },
  mcp: { fn: mcp, summary: 'Print MCP configuration for a coding agent' },
};

const HELP = `${bold('bo')} — BufferOverride from the terminal

${bold('USAGE')}
  bo <command> [options]

${bold('COMMANDS')}
${Object.entries(COMMANDS)
  .map(([name, { summary }]) => `  ${name.padEnd(8)} ${dim(summary)}`)
  .join('\n')}

${bold('CAPTURE A FAILURE')}
  bo run -- bun test              Run it, keep what it printed, search for it
  bo run --dry-run -- pnpm build  Everything except publishing

${bold('EVERYTHING ELSE')}
  bo search "worker exited before finishing"
  bo get 1842
  bo ask --title "..." --tag bun
  bo answer 1842 --file answer.md
  bo verify 1842 --answer 3921 -- pnpm test
  bo login --provider coinpay
  bo mcp config

${bold('OPTIONS')}
  --json                 Machine-readable output on stdout
  --dry-run              Do the work, publish nothing
  -y, --yes              Do not prompt; take the default
  --url <origin>         Point at another deployment
  --token <bo_...>       Use this credential for one call
  --no-color             Plain text
  -h, --help             This
  -v, --version          Print the version

${bold('SAFETY')}
  Redaction is best effort and cannot be complete — no pattern list catches a
  custom-format secret. Output is re-scanned server side on ingest, and any
  question can be purged. Treat ${bold('--dry-run')} as the default habit.

  ${dim('https://bufferoverride.com/docs/cli')}
`;

export async function main(argv) {
  const parsed = parseArgs(argv);
  const { flags, positional, command, unknown } = parsed;

  if (flags.color === false || flags['no-color']) setColor(false);

  if (flags.version && !positional.length) {
    out(VERSION);
    return 0;
  }

  const name = positional[0];

  if (!name || flags.help || name === 'help') {
    // `bo help search` should explain search, not print the whole sheet.
    const topic = name === 'help' ? positional[1] : name;
    if (topic && COMMANDS[topic]) {
      out(`${bold(topic)} — ${COMMANDS[topic].summary}`);
      out('');
      out(dim(`See https://bufferoverride.com/docs/cli#${topic}`));
      return 0;
    }
    out(HELP);
    return name ? 0 : 1;
  }

  const entry = COMMANDS[name];
  if (!entry) {
    fail(`Unknown command: ${name}`);
    const near = Object.keys(COMMANDS).filter((c) => c.startsWith(name[0]));
    if (near.length) out(dim(`Did you mean: ${near.join(', ')}?`));
    out(dim('bo --help'));
    return 2;
  }

  if (unknown.length) {
    fail(`Unrecognised: ${unknown.join(', ')}`);
    return 2;
  }

  return entry.fn({ flags, positional: positional.slice(1), command, argv });
}
