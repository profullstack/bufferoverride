import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCode, newCode, parseReference } from '../src/codes.ts';

// About 0.9% of raw 10-hex-character draws are all digits, so 5,000 draws
// would almost surely include one if newCode stopped redrawing.
test('newCode never issues a code that parses as a legacy id', () => {
  for (let i = 0; i < 5000; i++) {
    const code = newCode();
    assert.ok(isCode(code), code);
    assert.deepEqual(parseReference(code), { kind: 'code', code });
  }
});

test('an all-digit string is a legacy id, not a code', () => {
  assert.deepEqual(parseReference('9971475648'), { kind: 'id', id: 9971475648 });
  assert.equal(isCode('9971475648'), false);
});
