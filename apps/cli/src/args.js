/**
 * Argument parsing.
 *
 * Hand-rolled because the one thing this CLI must get exactly right is `--`:
 * everything after it is the user's command, and a parser that helpfully
 * interprets `--watch` or `-v` inside it would run the wrong thing. So the
 * split happens first, before any flag is looked at.
 */

const NEEDS_VALUE = new Set([
  'title',
  'tag',
  'body',
  'file',
  'answer',
  'result',
  'env',
  'environment',
  'notes',
  'valid-from',
  'valid-through',
  'attribution',
  'url',
  'token',
  'client',
  'provider',
  'limit',
  'name',
]);

const ALIASES = {
  t: 'title',
  f: 'file',
  a: 'answer',
  m: 'body',
  y: 'yes',
  n: 'limit',
  h: 'help',
  v: 'version',
};

/** Flags that may be repeated; their values collect into an array. */
const REPEATABLE = new Set(['tag']);

export function parseArgs(argv) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const command = separator === -1 ? [] : argv.slice(separator + 1);

  const positional = [];
  const flags = {};
  const unknown = [];

  for (let i = 0; i < own.length; i++) {
    const token = own[i];

    if (token === '-') {
      positional.push(token);
      continue;
    }

    if (token.startsWith('--')) {
      let name = token.slice(2);
      let value;
      const eq = name.indexOf('=');
      if (eq !== -1) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      if (name.startsWith('no-') && value === undefined && !NEEDS_VALUE.has(name)) {
        flags[name.slice(3)] = false;
        continue;
      }
      if (NEEDS_VALUE.has(name)) {
        if (value === undefined) value = own[++i];
        if (value === undefined) {
          unknown.push(`--${name} needs a value`);
          continue;
        }
        if (REPEATABLE.has(name)) (flags[name] ??= []).push(...String(value).split(',').filter(Boolean));
        else flags[name] = value;
      } else {
        flags[name] = value === undefined ? true : value !== 'false';
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      for (let j = 1; j < token.length; j++) {
        const short = token[j];
        const name = ALIASES[short];
        if (!name) {
          unknown.push(`-${short}`);
          continue;
        }
        if (NEEDS_VALUE.has(name)) {
          // -f value, or the rest of the cluster as the value: -fanswer.md
          const inline = token.slice(j + 1);
          const value = inline || own[++i];
          if (value === undefined) unknown.push(`-${short} needs a value`);
          else if (REPEATABLE.has(name)) (flags[name] ??= []).push(value);
          else flags[name] = value;
          break;
        }
        flags[name] = true;
      }
      continue;
    }

    positional.push(token);
  }

  return { positional, flags, command, unknown };
}

/** Tags arrive as --tag a --tag b, --tag a,b, or both. */
export function tagList(flags) {
  const raw = flags.tag ?? [];
  return [...new Set((Array.isArray(raw) ? raw : [raw]).flatMap((t) => String(t).split(',')).map((t) => t.trim()).filter(Boolean))];
}
