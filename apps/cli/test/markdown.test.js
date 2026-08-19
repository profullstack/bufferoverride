import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionToMarkdown, renderTerminal } from '../src/markdown.js';
import { setColor } from '../src/render.js';

// Colour is off under `node --test` anyway (no TTY); state it so the
// assertions below are about structure rather than about escape codes.
setColor(false);

test('a fence becomes an indented block, not a row of backticks', () => {
  const text = renderTerminal('Try this:\n\n```sh\nbun test\n```');
  assert.match(text, /^ {2}bun test$/m);
  assert.doesNotMatch(text, /```/);
});

test('the language of a fence is kept as a label', () => {
  const text = renderTerminal('```sql\nselect 1;\n```');
  assert.match(text, /^ {2}sql$/m);
});

test('a link keeps its href where it can be read', () => {
  const text = renderTerminal('See [the docs](https://example.com/a).');
  assert.match(text, /the docs \(https:\/\/example\.com\/a\)/);
});

test('an image is named rather than dropped', () => {
  const text = renderTerminal('![a flame graph](https://example.com/f.png)');
  assert.match(text, /\[image: a flame graph\] \(https:\/\/example\.com\/f\.png\)/);
});

test('emphasis markers do not survive as punctuation', () => {
  const text = renderTerminal('**bold** and *thin*');
  assert.equal(text, 'bold and thin');
});

test('a code span keeps its contents and loses its backticks', () => {
  const text = renderTerminal('Set `max_workers` first.');
  assert.equal(text, 'Set max_workers first.');
});

test('an underscore inside an identifier is left alone', () => {
  assert.equal(renderTerminal('the max_worker_threads flag'), 'the max_worker_threads flag');
});

test('a heading is set off from the prose around it', () => {
  const text = renderTerminal('# Why\nBecause.');
  assert.equal(text, 'Why\n\nBecause.');
});

test('lists render with a marker per item', () => {
  const text = renderTerminal('- one\n- two');
  assert.match(text, /^ {2}• one$/m);
  assert.match(text, /^ {2}• two$/m);
});

test('a task list shows its state', () => {
  const text = renderTerminal('- [x] done\n- [ ] pending');
  assert.match(text, /\[x\] done/);
  assert.match(text, /\[ \] pending/);
});

test('a quote is marked down the margin', () => {
  assert.match(renderTerminal('> quoted'), /│ quoted/);
});

const QUESTION = {
  id: 1842,
  code: 'a1b2c3d4e5',
  slug: 'bun-worker',
  title: 'Bun worker exits after importing libsql',
  body: '**It exits** with no output.\n\n```sh\nbun test\n```',
  author: 'anthony',
  attribution: 'human',
  created_at: '2026-08-19T00:00:00Z',
  answers: [
    {
      id: 3921,
      body: 'Pin the driver.',
      author: 'preshy',
      is_accepted: 1,
      verified_count: 2,
      valid_from: 'bun 1.1',
      valid_through: 'bun 1.3',
    },
  ],
};

test('the markdown document keeps the source verbatim, fences and all', () => {
  const doc = questionToMarkdown(QUESTION, { url: 'https://bufferoverride.com/q/a1b2c3d4e5/bun-worker' });
  assert.match(doc, /^# Bun worker exits after importing libsql$/m);
  assert.match(doc, /\*\*It exits\*\* with no output\./);
  assert.match(doc, /```sh\nbun test\n```/);
  assert.match(doc, /^## Answer 3921$/m);
  assert.match(doc, /accepted · verified 2x · bun 1\.1 – bun 1\.3 · by preshy/);
  assert.match(doc, /<https:\/\/bufferoverride\.com\/q\/a1b2c3d4e5\/bun-worker>/);
});

test('the document ends with exactly one newline and no run of blanks', () => {
  const doc = questionToMarkdown(QUESTION);
  assert.ok(doc.endsWith('\n'));
  assert.ok(!doc.endsWith('\n\n'));
  assert.doesNotMatch(doc, /\n{3,}/);
});

test('a question with no answers is still a whole document', () => {
  const doc = questionToMarkdown({ ...QUESTION, answers: [] });
  assert.match(doc, /^# Bun worker/m);
  assert.doesNotMatch(doc, /## Answer/);
});
