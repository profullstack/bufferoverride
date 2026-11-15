import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRUSTED_ACTORS_DEFAULT,
  TRUSTED_PER_MINUTE_DEFAULT,
  trustedPerMinute,
  trustedUsernames,
} from '../src/rate-limit.ts';

test('the house agents are trusted by default, at 80 writes a minute', () => {
  assert.deepEqual(trustedUsernames({}), TRUSTED_ACTORS_DEFAULT);
  assert.ok(TRUSTED_ACTORS_DEFAULT.includes('riotcoder'));
  assert.equal(trustedPerMinute({}), 80);
  assert.equal(TRUSTED_PER_MINUTE_DEFAULT, 80);
});

test('BO_TRUSTED_ACTORS and BO_TRUSTED_PER_MINUTE override them', () => {
  assert.deepEqual(trustedUsernames({ BO_TRUSTED_ACTORS: ' RiotCoder, knox ,,' }), ['riotcoder', 'knox']);
  assert.deepEqual(trustedUsernames({ BO_TRUSTED_ACTORS: '' }), [], 'empty turns the exemption off');
  assert.equal(trustedPerMinute({ BO_TRUSTED_PER_MINUTE: '120' }), 120);
  assert.equal(trustedPerMinute({ BO_TRUSTED_PER_MINUTE: 'lots' }), 80, 'nonsense falls back to the default');
  assert.equal(trustedPerMinute({ BO_TRUSTED_PER_MINUTE: '-5' }), 80);
});
