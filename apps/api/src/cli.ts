import { Hono } from 'hono';
import { db, env } from '@bufferoverride/db';
import {
  CLI_SCOPES,
  POLL_INTERVAL_SECONDS,
  SESSION_COOKIE,
  actorFromSessionToken,
  approveDeviceRequest,
  claimDeviceToken,
  denyDeviceRequest,
  findDeviceRequest,
  isSealableKey,
  listApiKeys,
  principalFromAuthHeader,
  readCookie,
  startDeviceAuthorization,
} from '@bufferoverride/auth';

export const cli = new Hono();

function baseUrl(): string {
  return env('PUBLIC_BASE_URL') ?? 'https://bufferoverride.com';
}

async function session(c: { req: { header(name: string): string | undefined } }) {
  return actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
}

/**
 * Start a device authorization.
 *
 * Unauthenticated on purpose — this is the one call a terminal can make before
 * it has any credential. It creates nothing but a ten-minute row, and a row
 * that is never approved grants nothing, so there is no reason to gate it
 * behind a credential the caller by definition does not have.
 */
cli.post('/v1/cli/device/start', async (c) => {
  const body = await c.req.json<{ publicKey?: string; label?: string }>().catch(() => ({}));
  const publicKey = (body.publicKey ?? '').trim();

  if (!isSealableKey(publicKey)) {
    return c.json(
      { error: 'invalid_public_key', message: 'Send a base64url DER SPKI X25519 public key.' },
      400,
    );
  }

  const started = await startDeviceAuthorization({ publicKey, label: body.label });
  const verification = `${baseUrl()}/account/cli`;

  return c.json({
    device_code: started.deviceCode,
    user_code: started.userCode,
    verification_uri: verification,
    verification_uri_complete: `${verification}?code=${encodeURIComponent(started.userCode)}`,
    interval: started.intervalSeconds,
    expires_at: started.expiresAt,
    scopes: CLI_SCOPES,
  });
});

/**
 * Poll for the credential. RFC 8628 error codes, so a generic device-flow
 * client understands the states without special-casing this server.
 */
cli.post('/v1/cli/device/token', async (c) => {
  const body = await c.req.json<{ device_code?: string }>().catch(() => ({}));
  const deviceCode = (body.device_code ?? '').trim();
  if (!deviceCode) return c.json({ error: 'invalid_request' }, 400);

  const claim = await claimDeviceToken(deviceCode);
  if (claim.status === 'pending') return c.json({ error: 'authorization_pending' }, 400);
  if (claim.status === 'denied') return c.json({ error: 'access_denied' }, 400);
  if (claim.status === 'expired') return c.json({ error: 'expired_token' }, 400);

  return c.json({ sealed_token: claim.sealed, scopes: claim.scopes });
});

// ── the browser half ──────────────────────────────────────────────────────
cli.get('/v1/cli/device/:code', async (c) => {
  const actor = await session(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  const request = await findDeviceRequest(c.req.param('code'));
  if (!request) return c.json({ error: 'not_found' }, 404);
  return c.json({ data: { ...request, scopes: CLI_SCOPES } });
});

cli.post('/v1/cli/device/:code/approve', async (c) => {
  const actor = await session(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);

  const outcome = await approveDeviceRequest(c.req.param('code'), actor.id);
  if (outcome === 'not_found')
    return c.json({ error: 'not_found', message: 'That code has expired. Run bo login again.' }, 404);
  if (outcome === 'already')
    return c.json({ error: 'already_decided', message: 'That code was already used.' }, 409);

  return c.json({ ok: true });
});

cli.post('/v1/cli/device/:code/deny', async (c) => {
  const actor = await session(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  await denyDeviceRequest(c.req.param('code'));
  return c.json({ ok: true });
});

// ── who am I ──────────────────────────────────────────────────────────────
/**
 * Identity for a caller holding either kind of credential.
 *
 * /v1/auth/session reads a cookie and is for the website; a terminal has a
 * bearer key and needs to know which account it is acting as and what that
 * key may do — including that it is a key, so `bo` can explain up front why
 * voting is not on offer rather than after a 403.
 */
cli.get('/v1/me', async (c) => {
  const key = await principalFromAuthHeader(c.req.header('authorization'));
  if (key) {
    return c.json({
      authenticated: true,
      via: 'key',
      actor: { username: key.actor.username, displayName: key.actor.display_name, kind: key.actor.kind },
      scopes: key.scopes,
    });
  }
  const actor = await session(c);
  if (!actor) return c.json({ authenticated: false }, 401);
  return c.json({
    authenticated: true,
    via: 'session',
    actor: { username: actor.username, displayName: actor.display_name, kind: actor.kind },
    scopes: ['*'],
  });
});

/** A human's own keys — the terminals they have signed in, and nothing else. */
cli.get('/v1/keys', async (c) => {
  const actor = await session(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  return c.json({ data: await listApiKeys(actor.id) });
});

/**
 * Sign this terminal out everywhere it was signed in.
 *
 * `bo logout` deletes the local file, which is enough when the machine is
 * still yours. This is the other case: revoke the key itself, from a browser,
 * on a laptop you no longer have.
 */
cli.post('/v1/keys/:id/revoke-own', async (c) => {
  const actor = await session(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  const r = await db().execute({
    sql: 'select id from api_keys where id = ? and actor_id = ?',
    args: [c.req.param('id'), actor.id],
  });
  if (!r.rows.length) return c.json({ error: 'not_your_key' }, 403);
  await db().batch(
    [
      {
        sql: `update api_keys set revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              where id = ? and revoked_at is null`,
        args: [c.req.param('id')],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'apikey.revoke', 'api_key', ?)`,
        args: [actor.id, c.req.param('id')],
      },
    ] as never,
    'write',
  );
  return c.json({ ok: true });
});

/** Poll interval the CLI honours, exported so both sides agree on one number. */
export const CLI_POLL_INTERVAL = POLL_INTERVAL_SECONDS;
