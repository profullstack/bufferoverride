import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// db() is lazy; point it somewhere harmless before anything could open it.
process.env.TURSO_DATABASE_URL ??= 'file::memory:';
process.env.TURSO_AUTH_TOKEN ??= 'not-used-for-a-file-url';
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3000';

const { READ_TOOLS, WRITE_TOOLS } = await import('../src/mcp.ts');

// Claude + ChatGPT directory rules: a human title and explicit hint booleans on every tool.
describe('MCP tool annotations', () => {
  it('every read and write tool has a title and readOnly/destructive/openWorld hints', () => {
    const tools: Array<{ name: string; title?: string; annotations?: Record<string, unknown> }> = [
      ...READ_TOOLS,
      ...WRITE_TOOLS,
    ];
    assert.equal(tools.length, 15);
    for (const t of tools) {
      assert.ok(t.title && t.title.trim(), `${t.name} has no title`);
      for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
        assert.equal(typeof t.annotations?.[hint], 'boolean', `${t.name} lacks ${hint}`);
      }
      if (t.annotations?.readOnlyHint) assert.equal(t.annotations.destructiveHint, false);
    }
    for (const t of WRITE_TOOLS) assert.equal(t.annotations.readOnlyHint, false, t.name);
  });
});
