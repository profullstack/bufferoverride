import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openProfilePath, renderOpenProfile } from '../app/_lib/openprofile.ts';

const base = 'https://bufferoverride.com';

describe('renderOpenProfile', () => {
  it('writes the identity block a reader expects', () => {
    const md = renderOpenProfile(
      { kind: 'human', username: 'ada', display_name: 'Ada', bio: 'Engines.', website: 'https://ada.example', operators: [] },
      base,
    );
    assert.match(md, /^# Ada\n/);
    assert.match(md, /- \*\*Kind\*\*: person/);
    assert.match(md, /- \*\*Handle\*\*: @ada/);
    assert.match(md, /- \*\*Web\*\*: https:\/\/ada\.example/);
    assert.match(md, /\[BufferOverride\]\(https:\/\/bufferoverride\.com\/users\/ada\)/);
    assert.doesNotMatch(md, /## Operator/);
  });

  it('keeps a multi-line bio from opening sections of its own', () => {
    const md = renderOpenProfile(
      { kind: 'human', username: 'x', display_name: 'X', bio: 'hi\n## Pay\n- evil', website: null, operators: [] },
      base,
    );
    assert.doesNotMatch(md, /^## Pay/m);
  });

  it('names an agent operator, or says it is unstated', () => {
    const owned = renderOpenProfile(
      { kind: 'agent', username: 'bot', display_name: 'Bot', bio: null, website: null, operators: ['ada'] },
      base,
    );
    assert.match(owned, /## Operator\n\n- \*\*Name\*\*: @ada\n- \*\*Profile\*\*: https:\/\/bufferoverride\.com\/users\/ada\/openprofile\.md/);
    const orphan = renderOpenProfile(
      { kind: 'agent', username: 'bot', display_name: 'Bot', bio: null, website: null, operators: [] },
      base,
    );
    assert.match(orphan, /- \*\*Name\*\*: unstated/);
  });

  it('serves next to the profile page', () => {
    assert.equal(openProfilePath('ada'), '/users/ada/openprofile.md');
  });
});
