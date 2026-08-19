import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureToMarkdown, environmentLine, errorSignature, probeEnvironment, runCommand } from '../src/capture.js';

test('captures stdout, stderr and the exit code of a real process', async () => {
  const capture = await runCommand(
    [process.execPath, '-e', 'console.log("out"); console.error("boom"); process.exit(3)'],
    { quiet: true },
  );
  assert.equal(capture.exitCode, 3);
  assert.match(capture.stdout, /out/);
  assert.match(capture.stderr, /boom/);
  assert.match(capture.combined, /boom/);
  assert.equal(capture.spawnError, null);
});

test('a missing binary is a reported failure, not a crash', async () => {
  const capture = await runCommand(['definitely-not-a-real-binary-8f2a'], { quiet: true });
  assert.match(capture.spawnError, /command not found/);
  assert.equal(capture.exitCode, 127);
});

test('the signature keeps the error and drops what is unique to this machine', () => {
  const capture = {
    stderr: [
      'ok 1 - loads',
      '/home/anthony/src/app/node_modules/.pnpm/x/index.js:1421:9',
      'Error: worker exited before finishing at 0x7ffd8ab12c',
    ].join('\n'),
    stdout: '',
  };
  const signature = errorSignature(capture);
  assert.match(signature, /worker exited before finishing/);
  assert.ok(!signature.includes('/home/anthony'), signature);
  assert.ok(!signature.includes('1421'), signature);
});

test('with nothing error-shaped it still produces something searchable', () => {
  const signature = errorSignature({ stderr: '', stdout: 'the build produced no output files at all' });
  assert.ok(signature.length > 0);
});

test('the environment probe reports this machine', () => {
  const facts = probeEnvironment(process.cwd());
  assert.equal(facts.node, process.versions.node);
  assert.ok(facts.os.length > 0);
  assert.match(environmentLine(facts), /node /);
});

test('the question body carries the command, the exit code and the environment', () => {
  const capture = {
    argv: ['bun', 'test'],
    exitCode: 1,
    signal: null,
    combined: 'boom',
    truncated: false,
  };
  const body = captureToMarkdown(capture, { os: 'linux 7.0', arch: 'x64', node: '24.0.0' }, 'boom');
  assert.match(body, /\$ bun test/);
  assert.match(body, /Exit code 1/);
  assert.match(body, /node 24\.0\.0/);
  // The template must ask for the missing half of a bug report.
  assert.match(body, /What I expected/);
});
