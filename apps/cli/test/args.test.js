import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, tagList } from '../src/args.js';
import { questionRef } from '../src/api.js';
import { questionLine, setColor } from '../src/render.js';

setColor(false);

test('everything after -- is the user command, untouched', () => {
  const { command, flags, positional } = parseArgs(['run', '--dry-run', '--', 'bun', 'test', '--watch', '-v']);
  assert.deepEqual(positional, ['run']);
  assert.equal(flags['dry-run'], true);
  // The point of the split: --watch and -v belong to bun, not to bo.
  assert.deepEqual(command, ['bun', 'test', '--watch', '-v']);
});

test('a command with no flags of its own still separates', () => {
  const { command } = parseArgs(['run', '--', 'make']);
  assert.deepEqual(command, ['make']);
});

test('value flags accept both spellings', () => {
  const a = parseArgs(['ask', '--title', 'a long enough title here']);
  const b = parseArgs(['ask', '--title=a long enough title here']);
  assert.equal(a.flags.title, b.flags.title);
});

test('tags collect from repetition and from commas', () => {
  const { flags } = parseArgs(['ask', '--tag', 'bun', '--tag', 'libsql,sqlite']);
  assert.deepEqual(tagList(flags), ['bun', 'libsql', 'sqlite']);
});

test('short flags cluster, and a value-taking one ends the cluster', () => {
  const { flags } = parseArgs(['answer', '1842', '-yf', 'answer.md']);
  assert.equal(flags.yes, true);
  assert.equal(flags.file, 'answer.md');
});

test('--no-x negates', () => {
  const { flags } = parseArgs(['mcp', 'config', '--no-color']);
  assert.equal(flags.color, false);
});

test('a value flag with no value is reported rather than swallowed', () => {
  const { unknown } = parseArgs(['ask', '--title']);
  assert.equal(unknown.length, 1);
});

test('positionals survive flags on either side', () => {
  const { positional } = parseArgs(['verify', '1842', '--answer', '3921']);
  assert.deepEqual(positional, ['verify', '1842']);
});

test('a question is addressed by its code, which is all search returns', () => {
  // The regression: /v1/search carries `code` and no `id`, so rendering the
  // row id printed "#undefined" on the first command anyone runs.
  assert.equal(questionRef({ code: 'a1b2c3d4e5', slug: 'x' }), 'a1b2c3d4e5');
  assert.match(questionLine({ code: 'a1b2c3d4e5', title: 'Bun worker exits', answer_count: 1 }), /#a1b2c3d4e5/);
  assert.doesNotMatch(questionLine({ code: 'a1b2c3d4e5', title: 'x', answer_count: 0 }), /undefined/);
});

test('the code wins over a row id that is still present', () => {
  assert.equal(questionRef({ id: 3, code: 'a1b2c3d4e5' }), 'a1b2c3d4e5');
});

test('a payload carrying only a legacy id still addresses the question', () => {
  assert.equal(questionRef({ id: 1842 }), 1842);
  assert.equal(questionRef(undefined), undefined);
});
