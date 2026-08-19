import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Long text comes from an editor, a file, or stdin — never from a flag.
 *
 * A question body typed as a shell argument is a body with no newlines in it,
 * and that is most of what makes a bug report readable. $VISUAL then $EDITOR,
 * falling back to something that exists on the platform.
 */
export function editorCommand() {
  const configured = process.env.VISUAL || process.env.EDITOR;
  if (configured) return configured;
  return process.platform === 'win32' ? 'notepad' : 'nano';
}

/** Lines starting with a comment marker are stripped, git-style. */
export function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('#!#'))
    .join('\n')
    .trim();
}

export function editText(initial, { suffix = '.md', instructions = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bo-'));
  const path = join(dir, `draft${suffix}`);

  const preamble = instructions.length
    ? `${instructions.map((line) => `#!# ${line}`).join('\n')}\n#!#\n`
    : '';
  writeFileSync(path, `${preamble}${initial}`, 'utf8');

  const command = editorCommand();
  const result = spawnSync(command, [path], { stdio: 'inherit', shell: true });

  try {
    if (result.error) return { text: null, error: `could not start ${command}: ${result.error.message}` };
    if (result.status !== 0) return { text: null, error: `${command} exited ${result.status}` };
    return { text: stripComments(readFileSync(path, 'utf8')), error: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Resolve body text from the four ways a caller can supply it.
 *
 * Explicit sources win over the editor so the command stays scriptable: a CI
 * job piping a file must never find itself blocked on nano.
 */
export async function resolveBody({ flags, initial = '', instructions = [] }) {
  if (flags.file === '-') return { text: (await readStdin()).trim(), source: 'stdin' };
  if (flags.file) {
    try {
      return { text: readFileSync(flags.file, 'utf8').trim(), source: flags.file };
    } catch (err) {
      return { text: null, error: `cannot read ${flags.file}: ${err.code ?? err.message}` };
    }
  }
  if (flags.body) return { text: String(flags.body).trim(), source: 'flag' };

  if (!process.stdin.isTTY) {
    const piped = (await readStdin()).trim();
    if (piped) return { text: piped, source: 'stdin' };
  }

  if (flags.yes) return { text: initial.trim(), source: 'template' };

  const edited = editText(initial, { instructions });
  if (edited.error) return { text: null, error: edited.error };
  return { text: edited.text, source: 'editor' };
}
