import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// A file-backed libSQL database, set before anything opens a client. No mail
// key: the magic link is logged, which is how this test reads it back.
const dir = mkdtempSync(join(tmpdir(), 'bo-profile-'));
process.env.TURSO_DATABASE_URL = `file:${join(dir, 'test.db')}`;
process.env.TURSO_AUTH_TOKEN = 'not-used-for-a-file-url';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
delete process.env.RESEND_API_KEY;

const { db, migrate } = await import('@bufferoverride/db');
const { auth } = await import('../src/auth.ts');

/** POST /v1/auth/magic and return the link the (unconfigured) mailer logged. */
async function requestLink(body: Record<string, unknown>) {
  const logged: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void logged.push(args.join(' '));
  try {
    const res = await auth.request('/v1/auth/magic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const link = logged.join('\n').match(/https?:\/\/\S+\/auth\/magic\?token=\S+/)?.[0];
    return { res, link };
  } finally {
    console.warn = warn;
  }
}

describe('signup profile', () => {
  before(async () => {
    await migrate();
  });

  it('refuses a signup without a name before sending any link', async () => {
    const { res, link } = await requestLink({ email: 'nobody@acme.com', signup: true, first_name: 'Ada' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errors: Record<string, string> };
    assert.ok(body.errors.last_name);
    assert.equal(link, undefined);
  });

  it('stores the fields privately when the signup link is followed', async () => {
    const { res, link } = await requestLink({
      email: 'Ada@Acme.com',
      signup: true,
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_domain: 'https://www.acme.com/about',
      job_title: 'VP Engineering',
      linkedin_url: 'in/ada-lovelace',
    });
    assert.equal(res.status, 200);
    assert.ok(link, 'a link was issued');

    const follow = await auth.request(new URL(link!).pathname + new URL(link!).search);
    assert.equal(follow.status, 302);
    const cookie = follow.headers.get('set-cookie')!.split(';')[0];

    const me = await auth.request('/v1/me/profile', { headers: { cookie } });
    assert.equal(me.status, 200);
    const data = (await me.json()) as { profile?: Record<string, string> } & Record<string, string>;
    const profile = data.profile ?? data;
    assert.equal(profile.email, 'ada@acme.com');
    assert.equal(profile.first_name, 'Ada');
    assert.equal(profile.last_name, 'Lovelace');
    assert.equal(profile.company_domain, 'acme.com');
    assert.equal(profile.job_title, 'VP Engineering');
    assert.equal(profile.linkedin_url, 'https://www.linkedin.com/in/ada-lovelace');

    // Never on the public actor row.
    const actor = await db().execute({ sql: 'select display_name from actors where email = ?', args: ['ada@acme.com'] });
    assert.notEqual(actor.rows[0]?.display_name, 'Ada Lovelace');
  });

  it('plain sign-in asks for nothing', async () => {
    const { res, link } = await requestLink({ email: 'grace@navy.mil' });
    assert.equal(res.status, 200);
    assert.ok(link);
  });

  it('answers 401 JSON to a visitor without a session', async () => {
    const res = await auth.request('/v1/me/profile');
    assert.equal(res.status, 401);
  });
});
