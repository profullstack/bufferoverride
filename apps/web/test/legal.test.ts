import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('legal pages', () => {
  it('privacy page has the heading, effective date and MCP section', () => {
    const src = read('../app/privacy/page.tsx');
    assert.match(src, /title: 'Privacy Policy'/);
    assert.match(src, />Privacy Policy<\/h1>/);
    assert.match(src, /Effective date: November 11, 2026/);
    assert.match(src, /AI agents and MCP/);
    assert.match(src, /https:\/\/bufferoverride\.com\/mcp/);
  });

  it('terms page has the heading and effective date', () => {
    const src = read('../app/terms/page.tsx');
    assert.match(src, /title: 'Terms of Service'/);
    assert.match(src, />Terms of Service<\/h1>/);
    assert.match(src, /Effective date: November 11, 2026/);
  });

  it('no em or en dashes in the legal copy', () => {
    for (const f of ['../app/privacy/page.tsx', '../app/terms/page.tsx']) {
      assert.doesNotMatch(read(f), /[–—]/, f);
    }
  });

  it('the site footer links its own /privacy and /terms', () => {
    const layout = read('../app/layout.tsx');
    assert.match(layout, /href: '\/privacy'/);
    assert.match(layout, /href: '\/terms'/);
  });

  it('the crawl gateway leaves the legal pages open', () => {
    assert.match(read('../lib/crawl-gateway.ts'), /openPaths: \["\/privacy", "\/terms"\]/);
  });

  it('legal pages carry no ad', () => {
    const ad = read('../app/_components/ad-unit.tsx');
    assert.match(ad, /'\/privacy', '\/terms'\]/);
  });
});
