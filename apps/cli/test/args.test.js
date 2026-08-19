import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, tagList } from '../src/args.js';

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
