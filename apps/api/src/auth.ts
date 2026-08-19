import { Hono } from 'hono';
import {
  SESSION_COOKIE,
  actorFromSessionToken,
  authenticationOptions,
  beginAuthorization,
  challengeCookie,
  clearedSessionCookie,
  clearedStateCookie,
  COINPAY_STATE_COOKIE,
  CHALLENGE_COOKIE,
  completeAuthorization,
  consumeMagicLink,
  createSession,
  destroySession,
  isEmail,
  linkedIdentities,
  listPasskeys,
  readCookie,
  readState,
  registrationOptions,
  requestMagicLink,
  requestOrigin,
  sessionCookie,
  unlinkCoinpay,
  verifyAuthentication,
  verifyRegistration,
} from '@bufferoverride/auth';

export const auth = new Hono();

/**
 * The origin this request arrived on, allowlisted — see packages/auth/origin.
 *
 * `Host` is a forbidden header name on a fetch Request, so Hono never exposes
 * it; the node adapter has already folded it into the request URL, which is
 * where it has to be read back from.
 */
function originOf(c: { req: { url: string; header(name: string): string | undefined } }): string {
  const urlHost = (() => {
    try {
      return new URL(c.req.url).host;
    } catch {
      return undefined;
    }
  })();
  return requestOrigin((name) =>
    name.toLowerCase() === 'host' ? (c.req.header('host') ?? urlHost) : c.req.header(name),
  );
}

/** Only ever bounce to a path on this origin — never to a supplied absolute URL. */
function safeReturn(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

async function currentActor(c: { req: { header(name: string): string | undefined } }) {
  return actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
}

// ── magic link ────────────────────────────────────────────────────────────
auth.post('/v1/auth/magic', async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = (body.email ?? '').trim();

  // The response never distinguishes a known address from an unknown one, an
  // invalid one, or a rate-limited one: anything else enumerates our users.
  if (isEmail(email)) {
    try {
      await requestMagicLink(email, c.req.header('x-forwarded-for'), originOf(c));
    } catch (err) {
      console.error('[auth] magic link request failed:', err);
    }
  }
  return c.json({ ok: true, message: 'If that address can receive mail, a link is on its way.' });
});

auth.get('/auth/magic', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/login?error=invalid_link', 302);

  const result = await consumeMagicLink(token).catch(() => null);
  if (!result) return c.redirect('/login?error=expired_link', 302);

  const session = await createSession(result.actor.id, c.req.header('user-agent'));
  c.header('set-cookie', sessionCookie(session, undefined, originOf(c)));
  return c.redirect(result.created ? '/account?welcome=1' : '/', 302);
});

// ── CoinPay OAuth ─────────────────────────────────────────────────────────
auth.get('/auth/coinpay/start', async (c) => {
  try {
    const { url, cookie } = beginAuthorization(safeReturn(c.req.query('returnTo')), originOf(c));
    c.header('set-cookie', cookie);
    return c.redirect(url, 302);
  } catch (err) {
    console.error('[auth] coinpay start failed:', err);
    return c.redirect('/login?error=coinpay_unconfigured', 302);
  }
});

auth.get('/auth/coinpay/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const stored = readState(readCookie(c.req.header('cookie'), COINPAY_STATE_COOKIE));

  c.header('set-cookie', clearedStateCookie());

  if (c.req.query('error')) return c.redirect('/login?error=coinpay_denied', 302);
  if (!code || !state || !stored || stored.state !== state) {
    return c.redirect('/login?error=bad_state', 302);
  }

  const existing = await currentActor(c);
  try {
    const { actor, created } = await completeAuthorization(
      code,
      stored.verifier,
      stored.redirectUri,
      existing?.id,
    );
    if (!existing) {
      const session = await createSession(actor.id, c.req.header('user-agent'));
      c.header('set-cookie', sessionCookie(session, undefined, originOf(c)), { append: true });
    }
    return c.redirect(created ? '/account?welcome=1' : safeReturn(stored.returnTo), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[auth] coinpay callback failed:', message);
    if (message === 'coinpay_already_linked') {
      return c.redirect('/account?error=already_linked', 302);
    }
    return c.redirect('/login?error=coinpay_failed', 302);
  }
});

auth.post('/auth/coinpay/unlink', async (c) => {
  const actor = await currentActor(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  await unlinkCoinpay(actor.id);
  return c.json({ ok: true });
});

// ── passkeys ──────────────────────────────────────────────────────────────
auth.post('/auth/passkey/register/options', async (c) => {
  const actor = await currentActor(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  const origin = originOf(c);
  const { options, handle } = await registrationOptions(actor, origin);
  c.header('set-cookie', challengeCookie(handle, origin));
  return c.json(options);
});

auth.post('/auth/passkey/register/verify', async (c) => {
  const actor = await currentActor(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json<{ response: never; label?: string }>();
  const handle = readCookie(c.req.header('cookie'), CHALLENGE_COOKIE);
  const ok = await verifyRegistration(actor, handle, body.response, body.label, originOf(c));
  return ok ? c.json({ ok: true }) : c.json({ error: 'verification_failed' }, 400);
});

auth.post('/auth/passkey/login/options', async (c) => {
  const origin = originOf(c);
  const { options, handle } = await authenticationOptions(origin);
  c.header('set-cookie', challengeCookie(handle, origin));
  return c.json(options);
});

auth.post('/auth/passkey/login/verify', async (c) => {
  const body = await c.req.json<{ response: never }>();
  const handle = readCookie(c.req.header('cookie'), CHALLENGE_COOKIE);
  const actor = await verifyAuthentication(handle, body.response, originOf(c));
  if (!actor) return c.json({ error: 'verification_failed' }, 400);
  const session = await createSession(actor.id, c.req.header('user-agent'));
  c.header('set-cookie', sessionCookie(session));
  return c.json({ ok: true, username: actor.username });
});

// ── session ───────────────────────────────────────────────────────────────
auth.get('/v1/auth/session', async (c) => {
  const actor = await currentActor(c);
  if (!actor) return c.json({ authenticated: false });
  return c.json({
    authenticated: true,
    actor: { username: actor.username, displayName: actor.display_name, kind: actor.kind },
    identities: await linkedIdentities(actor.id),
    passkeys: (await listPasskeys(actor.id)).length,
  });
});

auth.post('/auth/logout', async (c) => {
  await destroySession(readCookie(c.req.header('cookie'), SESSION_COOKIE));
  c.header('set-cookie', clearedSessionCookie(originOf(c)));
  const accepts = c.req.header('accept') ?? '';
  if (accepts.includes('text/html')) return c.redirect('/', 302);
  return c.json({ ok: true });
});
