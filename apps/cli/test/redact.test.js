import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactAll, redactSecrets, scanSecrets } from '../src/redact.js';

test('catches the common catastrophic shapes', () => {
  const text = [
    'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    'authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
    'postgres://admin:hunter2hunter2@db.internal:5432/app',
  ].join('\n');

  const kinds = scanSecrets(text).map((f) => f.kind);
  assert.ok(kinds.includes('Anthropic key'), kinds.join(','));
  assert.ok(kinds.includes('connection string password'), kinds.join(','));
});

test('a reference to a credential is not a credential', () => {
  // Developers paste this constantly. Flagging it trains the warning away.
  const findings = scanSecrets('const token = process.env.GITHUB_TOKEN;\napiKey: import.meta.env.VITE_KEY');
  assert.deepEqual(findings, []);
});

test('placeholders are not secrets', () => {
  assert.deepEqual(scanSecrets('api_key = "your-key-here"'), []);
  assert.deepEqual(scanSecrets('password: xxxxxxxxxxxx'), []);
});

test('redaction replaces the value and leaves the shape readable', () => {
  const { text, findings } = redactSecrets('token=ghp_012345678901234567890123456789012345');
  // Two rules match this line — the token shape and the assignment — and both
  // are reported. Overlapping findings are the intended behaviour: suppressing
  // one would mean choosing which half of the evidence the author gets to see.
  assert.ok(findings.length >= 1);
  assert.ok(!text.includes('ghp_012345678901234567890123456789012345'));
  assert.match(text, /REDACTED/);
});

test('values from the local environment are blanked whatever shape they are', () => {
  // The case pattern matching cannot reach: a bespoke credential format that
  // happens to be sitting in this process's environment.
  const environment = { COMPANY_DEPLOY_SECRET: 'zzq-9182-not-a-known-shape-at-all' };
  const { text, envNames, count } = redactAll(
    'curl failed with header X-Auth: zzq-9182-not-a-known-shape-at-all',
    environment,
  );
  assert.ok(!text.includes('zzq-9182-not-a-known-shape-at-all'));
  assert.deepEqual(envNames, ['COMPANY_DEPLOY_SECRET']);
  assert.equal(count, 1);
});

test('short or innocuously-named environment values are left alone', () => {
  const environment = { HOME: '/home/somebody', EDITOR: 'nano', PATH: '/usr/bin:/bin' };
  const { text, count } = redactAll('nano exited 1 in /home/somebody', environment);
  assert.equal(count, 0);
  assert.equal(text, 'nano exited 1 in /home/somebody');
});

test('a BufferOverride key in pasted output is caught too', () => {
  const kinds = scanSecrets('bo login gave me bo_AbCdEfGhIjKlMnOpQrStUvWxYz012345').map((f) => f.kind);
  assert.ok(kinds.includes('BufferOverride key'), kinds.join(','));
});
