import { createInterface } from 'node:readline/promises';

/**
 * Terminal output.
 *
 * Colour is opt-out three ways — NO_COLOR, --no-color, and not being a TTY —
 * because this output gets piped into files and CI logs constantly and escape
 * codes there are just noise. Everything user-facing goes to stdout; progress
 * and diagnostics go to stderr, so `bo search x --json > out.json` yields
 * clean JSON.
 */

const enabled = () =>
  !process.env.NO_COLOR && process.env.TERM !== 'dumb' && process.stdout.isTTY === true;

let colorOn = enabled();

export function setColor(on) {
  colorOn = on && enabled();
}

const wrap = (code) => (text) => (colorOn ? `\u001b[${code}m${text}\u001b[0m` : String(text));

export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const blue = wrap('36');

export function out(line = '') {
  process.stdout.write(`${line}\n`);
}

export function note(line = '') {
  process.stderr.write(`${line}\n`);
}

export function fail(message) {
  process.stderr.write(`${red('error')} ${message}\n`);
}

export function json(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** A hanging indent, so a wrapped title still lines up under itself. */
export function indent(text, width = 6) {
  const pad = ' '.repeat(width);
  return String(text)
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

export function truncate(text, max = 100) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * One line per question, in the shape the docs promise:
 *
 *   #1842 Bun worker exits after importing libsql
 *         canonical · verified 2x · bun 1.1 - 1.3
 */
export function questionLine(hit) {
  const facts = [];
  if (hit.is_canonical) facts.push('canonical');
  const verified = Number(hit.verified ?? hit.verified_count ?? 0);
  if (verified > 0) facts.push(`verified ${verified}x`);
  const answers = Number(hit.answer_count ?? 0);
  facts.push(answers === 0 ? 'unanswered' : `${answers} answer${answers === 1 ? '' : 's'}`);
  if (hit.valid_from || hit.valid_through) {
    facts.push([hit.valid_from, hit.valid_through].filter(Boolean).join(' - '));
  }
  return `${bold(`#${hit.id}`)} ${truncate(hit.title, 88)}\n${indent(dim(facts.join(' · ')))}`;
}

/** Ask a question on the terminal. Non-interactive callers must not reach here. */
export async function prompt(question, { fallback = '' } = {}) {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirm(question, { defaultYes = false, assumeYes = false } = {}) {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) return defaultYes;
  const answer = await prompt(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `);
  if (!answer) return defaultYes;
  return /^y(es)?$/i.test(answer);
}
