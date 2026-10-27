import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'bo-coinpay-'));
process.env.TURSO_DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.TURSO_AUTH_TOKEN = 'not-used-for-a-file-url';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.COINPAY_CLIENT_ID = 'cp_test';
process.env.COINPAY_CLIENT_SECRET = 'secret';

const { db, migrate } = await import('@bufferoverride/db');
const { completeAuthorization, findOrCreateByEmail, actorById } = await import('@bufferoverride/auth');

/** CoinPay answers as itself: whatever address the account typed, never verified. */
function coinpayAs(sub: string, email: string): void {
  globalThis.fetch = (async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith('/api/oauth/token')) return Response.json({ access_token: `at-${sub}`, scope: 'openid profile email' });
    if (href.endsWith('/api/oauth/userinfo')) return Response.json({ sub, email, email_verified: false, name: 'Mallory' });
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
}

describe('Sign in with CoinPay never trusts the CoinPay email', () => {
  before(async () => {
    await migrate();
  });

  it('a CoinPay login with an existing account\'s email does not get that account', async () => {
    const victim = await findOrCreateByEmail('victim@example.com');
    coinpayAs('cp-attacker-1', 'victim@example.com');
    const { actor, created } = await completeAuthorization('code', 'verifier', 'http://localhost:3000/api/v1/coinpay/callback');
    assert.equal(created, true);
    assert.notEqual(actor.id, victim.actor.id);
    assert.equal(actor.email, null);
  });

  it('a CoinPay account cannot pre-claim an address: the owner\'s magic link makes their own account', async () => {
    coinpayAs('cp-attacker-2', 'later@example.com');
    const { actor: squatter } = await completeAuthorization('code', 'verifier', 'http://localhost:3000/api/v1/coinpay/callback');
    assert.equal((await actorById(squatter.id))?.email, null);
    const owner = await findOrCreateByEmail('later@example.com');
    assert.equal(owner.created, true);
    assert.notEqual(owner.actor.id, squatter.id);
  });

  it('the same CoinPay subject comes back to the same actor', async () => {
    coinpayAs('cp-returning', 'x@example.com');
    const first = await completeAuthorization('code', 'verifier', 'http://localhost:3000/api/v1/coinpay/callback');
    coinpayAs('cp-returning', 'changed@example.com');
    const again = await completeAuthorization('code', 'verifier', 'http://localhost:3000/api/v1/coinpay/callback');
    assert.equal(again.actor.id, first.actor.id);
    assert.equal(again.created, false);
    void db;
  });
});
