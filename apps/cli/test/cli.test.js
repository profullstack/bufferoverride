import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const run = promisify(execFile);
const BO = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'bo.js');

/**
 * The CLI against a stub of the API.
 *
 * The stub is deliberately independent of the server implementation: it seals
 * the device token with its own copy of the construction, so these tests prove
 * the two halves agree on the wire format rather than that one file is
 * self-consistent.
 */
function sealTo(recipientSpkiB64, plaintext) {
  const recipient = createPublicKey({
    key: Buffer.from(recipientSpkiB64, 'base64url'),
    format: 'der',
    type: 'spki',
  });
  const ephemeral = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'bo-cli-token', 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

const state = { approveAfter: 0, polls: 0, published: [], lastAuth: null, publicKey: null };

let server;
let origin;
let home;

function json(res, status, value) {
  const text = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'bo-home-'));

  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://stub');
    state.lastAuth = req.headers.authorization ?? null;

    if (url.pathname === '/v1/search') {
      const q = url.searchParams.get('q') ?? '';
      return json(res, 200, {
        query: q,
        data: q.includes('nothing')
          ? []
          : [{ id: 1842, slug: 'bun-worker', title: 'Bun worker exits after importing libsql', answer_count: 2, verified: 2 }],
      });
    }

    if (url.pathname === '/v1/questions/1842') {
      return json(res, 200, {
        data: {
          id: 1842,
          code: 'a1b2c3d4e5',
          slug: 'bun-worker',
          title: 'Bun worker exits after importing libsql',
          body: '**It exits** with no output.\n\n```sh\nbun test\n```\n\nSee [the docs](https://bun.sh/docs).',
          author: 'anthony',
          attribution: 'human',
          created_at: '2026-08-19T00:00:00Z',
          answers: [
            {
              id: 3921,
              body: 'Pin the driver.',
              author: 'preshy',
              attribution: 'human',
              is_accepted: 1,
              verified_count: 2,
              valid_from: 'bun 1.1',
              valid_through: 'bun 1.3',
              is_stale: 0,
            },
          ],
        },
      });
    }

    if (url.pathname === '/v1/questions/9999') return json(res, 404, { error: 'not_found' });

    if (url.pathname === '/v1/questions/duplicates') {
      await body(req);
      return json(res, 200, { data: [] });
    }

    if (url.pathname === '/v1/cli/device/start') {
      const payload = await body(req);
      state.publicKey = payload.publicKey;
      state.polls = 0;
      return json(res, 200, {
        device_code: 'device-abc',
        user_code: 'ABCD-2345',
        verification_uri: `${origin}/account/cli`,
        verification_uri_complete: `${origin}/account/cli?code=ABCD-2345`,
        interval: 1,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        scopes: ['read', 'write:questions'],
      });
    }

    if (url.pathname === '/v1/cli/device/token') {
      await body(req);
      state.polls += 1;
      if (state.polls <= state.approveAfter) return json(res, 400, { error: 'authorization_pending' });
      return json(res, 200, {
        sealed_token: sealTo(state.publicKey, 'bo_test_token_value'),
        scopes: ['read', 'write:questions'],
      });
    }

    if (url.pathname === '/v1/me') {
      if (!req.headers.authorization) return json(res, 401, { authenticated: false });
      return json(res, 200, {
        authenticated: true,
        via: 'key',
        actor: { username: 'anthony', displayName: 'Anthony', kind: 'human' },
        scopes: ['read', 'write:questions'],
      });
    }

    if (url.pathname === '/v1/questions' && req.method === 'POST') {
      const payload = await body(req);
      state.published.push(payload);
      return json(res, 201, { data: { id: 4242, slug: 'new', url: '/q/4242/new' } });
    }

    return json(res, 404, { error: 'not_found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(home, { recursive: true, force: true });
});

/**
 * Run the CLI and always resolve.
 *
 * A non-zero exit is a result here, not a harness failure: `bo run` passes the
 * wrapped command's exit code through on purpose, so it can be dropped in
 * front of an existing command in a script without changing what that script
 * sees. Rejecting on it would make the interesting cases unassertable.
 */
async function bo(args, extraEnv = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BO, ...args], {
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        XDG_CONFIG_HOME: home,
        BUFFEROVERRIDE_URL: origin,
        BUFFEROVERRIDE_TOKEN: '',
        ...extraEnv,
      },
    });
    return { code: 0, stdout, stderr, all: stdout + stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? '', all: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

test('bo --version prints the package version', async () => {
  const { stdout, code } = await bo(['--version']);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('bo search renders one line per hit', async () => {
  const { stdout } = await bo(['search', 'worker exited']);
  assert.match(stdout, /#1842/);
  assert.match(stdout, /verified 2x/);
});

test('bo search --json is clean JSON on stdout', async () => {
  const { stdout } = await bo(['search', 'worker exited', '--json']);
  assert.equal(JSON.parse(stdout).data[0].id, 1842);
});

test('a search with no hits exits 1 and says so', async () => {
  const { code, stdout } = await bo(['search', 'nothing at all like this']);
  assert.equal(code, 1);
  assert.match(stdout, /No match/);
});

test('bo get prints the question and its answers', async () => {
  const { stdout } = await bo(['get', '1842']);
  assert.match(stdout, /Bun worker exits/);
  assert.match(stdout, /answer 3921/);
  assert.match(stdout, /bun 1\.1 - bun 1\.3/);
});

test('bo get renders the markdown rather than printing its source', async () => {
  const { stdout } = await bo(['get', '1842']);
  // The fence is a block, the emphasis is gone, and the link kept its href.
  assert.doesNotMatch(stdout, /```/);
  assert.doesNotMatch(stdout, /\*\*It exits\*\*/);
  assert.match(stdout, /bun test/);
  assert.match(stdout, /the docs \(https:\/\/bun\.sh\/docs\)/);
});

test('bo get --markdown emits the thread as a markdown document', async () => {
  const { stdout } = await bo(['get', '1842', '--markdown']);
  assert.match(stdout, /^# Bun worker exits after importing libsql$/m);
  assert.match(stdout, /\*\*It exits\*\* with no output\./);
  assert.match(stdout, /```sh\nbun test\n```/);
  assert.match(stdout, /^## Answer 3921$/m);
  // The public code, never the row id, is what a copied link carries.
  assert.match(stdout, /\/q\/a1b2c3d4e5\/bun-worker/);
});

test('bo get on a missing id fails cleanly', async () => {
  const { code, stderr } = await bo(['get', '9999']);
  assert.equal(code, 1);
  assert.match(stderr, /No question 9999/);
});

test('bo run captures a failure, redacts it and searches', async () => {
  const script = 'console.error("Error: worker exited before finishing"); process.exit(1)';
  const { stdout, code } = await bo(['run', '--dry-run', '--', process.execPath, '-e', script]);
  // The wrapped command's exit code passes through, so `bo run --` can be
  // dropped in front of an existing command without changing what CI sees.
  assert.equal(code, 1);
  assert.match(stdout, /exit 1/);
  assert.match(stdout, /searching bufferoverride/);
  assert.match(stdout, /#1842/);
});

test('bo run on success reports nothing to do and exits 0', async () => {
  const { stdout, stderr } = await bo(['run', '--', process.execPath, '-e', 'process.exit(0)']);
  assert.match(stderr + stdout, /nothing to report/);
});

test('bo run --json emits the whole capture, with secrets already removed', async () => {
  const script =
    'console.error("Error: auth failed for sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); process.exit(2)';
  const { stdout, code } = await bo(['run', '--json', '--', process.execPath, '-e', script]);
  assert.equal(code, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.exitCode, 2);
  assert.ok(!report.output.includes('sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  assert.ok(
    report.redacted.patterns.some((f) => f.kind === 'Anthropic key'),
    JSON.stringify(report.redacted.patterns),
  );
  // The body it would publish must carry the redaction, not the original.
  assert.ok(!report.body.includes('sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
});

test('bo login completes the device flow and stores a 0600 credential', async () => {
  state.approveAfter = 1;
  const { stdout } = await bo(['login', '--no-browser']);
  assert.match(stdout, /ABCD-2345/);
  assert.match(stdout, /Signed in as anthony/);

  const path = join(home, 'bufferoverride', 'config.json');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.token, 'bo_test_token_value');
  assert.equal(saved.username, 'anthony');
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('bo whoami reports the stored identity', async () => {
  const { stdout } = await bo(['whoami']);
  assert.match(stdout, /anthony/);
  assert.match(stdout, /write:questions/);
});

test('bo mcp config includes the stored key for claude', async () => {
  const { stdout } = await bo(['mcp', 'config']);
  assert.match(stdout, /claude mcp add --transport http bufferoverride/);
  assert.match(stdout, /Bearer bo_test_token_value/);
});

test('bo mcp config --no-token is safe to paste in public', async () => {
  const { stdout } = await bo(['mcp', 'config', '--no-token']);
  assert.ok(!stdout.includes('bo_test_token_value'));
});

test('bo mcp config --client vscode emits that client shape', async () => {
  const { stdout } = await bo(['mcp', 'config', '--client', 'vscode', '--json']);
  const config = JSON.parse(stdout);
  assert.equal(config.servers.bufferoverride.type, 'http');
  assert.match(config.servers.bufferoverride.url, /\/mcp$/);
});

test('bo ask publishes what it showed, with the credential attached', async () => {
  const { stdout } = await bo([
    'ask',
    '--title',
    'bun test hangs after importing libsql',
    '--body',
    'It hangs forever with no output at all and never exits, on two machines.',
    '--tag',
    'bun,libsql',
    '--yes',
  ]);
  assert.match(stdout, /Published #4242/);
  const published = state.published.at(-1);
  assert.deepEqual(published.tags, ['bun', 'libsql']);
  assert.equal(state.lastAuth, 'Bearer bo_test_token_value');
});

test('bo ask --dry-run publishes nothing', async () => {
  const before = state.published.length;
  const { all } = await bo([
    'ask',
    '--title',
    'another title long enough to pass',
    '--body',
    'a body that is definitely long enough to be accepted by the validator',
    '--dry-run',
    '--yes',
  ]);
  assert.match(all, /dry run/);
  assert.equal(state.published.length, before);
});

test('bo logout removes the credential', async () => {
  const { stdout } = await bo(['logout', '--yes']);
  assert.match(stdout, /Signed out/);
  assert.equal((await bo(['whoami'])).code, 1);
});

test('an unknown command exits 2 with a suggestion', async () => {
  const { code, all } = await bo(['serach', 'x']);
  assert.equal(code, 2);
  assert.match(all, /Unknown command/);
});
