import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonForScript, markdownToText, renderMarkdown, safeImageUrl, safeUrl } from '../src/markdown.ts';

test('a paragraph is a paragraph', () => {
  assert.equal(renderMarkdown('Hello there.'), '<p>Hello there.</p>');
});

test('a fenced block keeps its language and its contents verbatim', () => {
  const html = renderMarkdown('```sql\nselect 1;\n```');
  assert.match(html, /<pre data-language="sql"><code class="language-sql">select 1;<\/code><\/pre>/);
});

test('markup inside a fence is text, not markup', () => {
  const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script/);
});

test('raw HTML in prose is shown, never executed', () => {
  const html = renderMarkdown('An <img src=x onerror=alert(1)> tag walks in.');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('a link is a link, and points off-site with rel set', () => {
  const html = renderMarkdown('See [the docs](https://example.com/a).');
  assert.match(html, /<a href="https:\/\/example\.com\/a" rel="nofollow ugc noopener" target="_blank">the docs<\/a>/);
});

test('an internal link is not given a target or a nofollow', () => {
  const html = renderMarkdown('See [question 4](/q/abc123/why).');
  assert.match(html, /<a href="\/q\/abc123\/why">question 4<\/a>/);
});

test('a bare URL hotlinks', () => {
  const html = renderMarkdown('Reported at https://github.com/a/b/issues/7 today.');
  assert.match(html, /<a href="https:\/\/github\.com\/a\/b\/issues\/7"[^>]*>https:\/\/github\.com\/a\/b\/issues\/7<\/a>/);
});

test('trailing punctuation stays out of a bare URL', () => {
  const html = renderMarkdown('See https://example.com/x.');
  assert.match(html, /href="https:\/\/example\.com\/x"/);
  assert.match(html, /<\/a>\.<\/p>/);
});

test('a bare www host is linked over https', () => {
  const html = renderMarkdown('Try www.sqlite.org for the details.');
  assert.match(html, /<a href="https:\/\/www\.sqlite\.org"/);
});

test('an image renders as an image', () => {
  const html = renderMarkdown('![a flame graph](https://example.com/f.png)');
  assert.match(html, /<img src="https:\/\/example\.com\/f\.png" alt="a flame graph" loading="lazy" decoding="async" \/>/);
});

test('a javascript: link is rendered as text, not as a link', () => {
  const html = renderMarkdown('[click](javascript:alert(1))');
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /\[click\]/);
});

test('a data: image is refused', () => {
  const html = renderMarkdown('![x](data:text/html;base64,PHNjcmlwdD4=)');
  assert.doesNotMatch(html, /<img/);
});

test('a scheme hidden behind a control character is refused', () => {
  assert.equal(safeUrl('java\nscript:alert(1)'), null);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeImageUrl('mailto:a@b.com'), null);
  assert.equal(safeUrl('https://example.com'), 'https://example.com');
  assert.equal(safeUrl('/q/abc/x'), '/q/abc/x');
});

test('a code span wins over emphasis inside it', () => {
  const html = renderMarkdown('Use `a ** b` carefully.');
  assert.match(html, /<code>a \*\* b<\/code>/);
  assert.doesNotMatch(html, /<strong>/);
});

test('emphasis, strong and strikethrough', () => {
  assert.match(renderMarkdown('**bold**'), /<strong>bold<\/strong>/);
  assert.match(renderMarkdown('*thin*'), /<em>thin<\/em>/);
  assert.match(renderMarkdown('~~gone~~'), /<del>gone<\/del>/);
});

test('an underscore inside an identifier is not emphasis', () => {
  const html = renderMarkdown('The flag is max_worker_threads today.');
  assert.doesNotMatch(html, /<em>/);
});

test('headings carry a linkable id', () => {
  const html = renderMarkdown('## What actually happens\n\nBody.');
  assert.match(html, /<h2 id="what-actually-happens">What actually happens<\/h2>/);
});

test('repeated headings get distinct ids', () => {
  const html = renderMarkdown('# Notes\n\n# Notes');
  assert.match(html, /id="notes"/);
  assert.match(html, /id="notes-2"/);
});

test('lists render, ordered and unordered', () => {
  assert.match(renderMarkdown('- one\n- two'), /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(renderMarkdown('1. one\n2. two'), /<ol><li>one<\/li><li>two<\/li><\/ol>/);
});

test('a task list renders a disabled checkbox', () => {
  const html = renderMarkdown('- [x] done\n- [ ] pending');
  assert.match(html, /<input type="checkbox" disabled checked \/>/);
  assert.match(html, /<input type="checkbox" disabled \/>/);
});

test('a blockquote nests its own blocks', () => {
  const html = renderMarkdown('> quoted **hard**');
  assert.match(html, /<blockquote><p>quoted <strong>hard<\/strong><\/p><\/blockquote>/);
});

test('a horizontal rule is a rule', () => {
  assert.match(renderMarkdown('---'), /<hr \/>/);
});

test('a table renders with alignment', () => {
  const html = renderMarkdown('| a | b |\n| :- | -: |\n| 1 | 2 |');
  assert.match(html, /<table><thead><tr><th style="text-align:left">a<\/th>/);
  assert.match(html, /<th style="text-align:right">b<\/th>/);
  assert.match(html, /<tbody><tr><td style="text-align:left">1<\/td>/);
});

test('an indented block is code', () => {
  const html = renderMarkdown('    npm run build\n');
  assert.match(html, /<pre><code>npm run build<\/code><\/pre>/);
});

test('an ampersand in prose survives exactly once', () => {
  const html = renderMarkdown('Tom & Jerry');
  assert.match(html, /Tom &amp; Jerry/);
  assert.doesNotMatch(html, /&amp;amp;/);
});

test('a quote character cannot break out of an attribute', () => {
  const html = renderMarkdown('[x](https://example.com/a"onmouseover="alert(1))');
  assert.doesNotMatch(html, /onmouseover="alert/);
});

test('markdownToText strips the markup for a description', () => {
  const text = markdownToText('# Title\n\nSee [docs](https://x.dev) and `code`.\n\n```\nignored\n```');
  assert.equal(text, 'Title See docs and code.');
});

test('the whole document round-trips into a single string', () => {
  const html = renderMarkdown(
    '# Why\n\nBecause **SQLite** takes one writer.\n\n```js\nconst db = open();\n```\n\n- see https://sqlite.org/wal.html\n',
  );
  assert.match(html, /<h1 id="why">Why<\/h1>/);
  assert.match(html, /<strong>SQLite<\/strong>/);
  assert.match(html, /class="language-js"/);
  assert.match(html, /<a href="https:\/\/sqlite\.org\/wal\.html"/);
});

test('a body cannot close the JSON-LD script element it sits in', () => {
  const payload = jsonForScript({ text: 'before </script><script>alert(1)</script> after' });
  assert.doesNotMatch(payload, /<\/script/i);
  assert.doesNotMatch(payload, /<script/i);
  // Still JSON, and still the same string once parsed.
  assert.equal(JSON.parse(payload).text, 'before </script><script>alert(1)</script> after');
});

test('line terminators legal in JSON but not in JavaScript are escaped', () => {
  const payload = jsonForScript({ text: 'a\u2028b\u2029c' });
  assert.doesNotMatch(payload, /[\u2028\u2029]/);
  assert.equal(JSON.parse(payload).text, 'a\u2028b\u2029c');
});
