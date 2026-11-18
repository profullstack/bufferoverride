import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { summarise, ugigHireUrl } from '../lib/ugig-cta.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('ugig hire link', () => {
  const question = {
    title: 'Why does bun install hang & exit with "EOF"?',
    body: '## Problem\n\nbun 1.4 hangs on install behind a [proxy](https://x.example).\n\n```sh\nbun install\n```',
    url: 'https://bufferoverride.com/q/abc12/why-does-bun-install-hang',
    tags: ['bun', 'npm', 'c++', 'a', 'b', 'c', 'd', 'e', 'f'],
  };

  it('points at ugig /gigs/new with every field encoded', () => {
    const href = ugigHireUrl(question);
    assert.ok(href.startsWith('https://ugig.net/gigs/new?'));
    assert.doesNotMatch(href, /[\s"<>]/);
    assert.match(href, /hang\+%26\+exit/);
    const p = new URL(href).searchParams;
    assert.equal(p.get('title'), question.title);
    assert.equal(
      p.get('description'),
      `${question.url}\n\nProblem bun 1.4 hangs on install behind a proxy.`,
    );
    assert.equal(p.get('skills'), 'bun,npm,c++,a,b,c,d,e');
    assert.equal(p.get('utm_source'), 'bufferoverride');
    assert.equal(p.get('utm_medium'), 'cta');
  });

  it('leaves skills out when the question has no tags', () => {
    const p = new URL(ugigHireUrl({ ...question, tags: [] })).searchParams;
    assert.equal(p.has('skills'), false);
  });

  it('keeps the excerpt short', () => {
    const long = ugigHireUrl({ ...question, body: 'word '.repeat(2000) });
    const description = new URL(long).searchParams.get('description') ?? '';
    assert.ok(description.length < question.url.length + 2 + 305, String(description.length));
  });

  it('summarise still trims markup for meta descriptions', () => {
    assert.equal(summarise('# Title\n\nSome `code` and **bold** prose that is long enough.'), 'Title Some and bold prose that is long enough.');
  });

  it('the question page renders the line under the answers, without em dashes', () => {
    const src = read('../app/q/[id]/[slug]/page.tsx');
    assert.match(src, /Need this solved for you\?/);
    assert.match(src, /Hire an AI agent or developer on ugig/);
    assert.ok(src.indexOf('styles.hire') < src.indexOf('<AnswerForm'));
    const line = src.slice(src.indexOf('styles.hire'), src.indexOf('<AnswerForm'));
    assert.doesNotMatch(line, /—/);
  });
});
