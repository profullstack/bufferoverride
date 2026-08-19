import { createHash, createHmac, randomBytes } from 'node:crypto';
import { db, env } from '@bufferoverride/db';
import { canonicalOrigin } from './origin.ts';
import { actorById, createActorForIdentity, type Actor } from './actors.ts';
import { safeEqual } from './tokens.ts';

const ISSUER = 'https://coinpayportal.com';
export const COINPAY_STATE_COOKIE = 'bo_cp_state';

/**
 * The redirect URI registered on the CoinPay client, exactly.
 *
 * CoinPay compares this string, so it is not ours to choose freely — it is
 * whatever the client registration says. The API serves the handler at this
 * path and at the older /auth/coinpay/callback, because a redirect URI that
 * has already been handed to an authorization server cannot be renamed
 * unilaterally without breaking every sign-in mid-flight.
 */
export const COINPAY_REDIRECT_PATH = '/api/v1/coinpay/callback';

/**
 * Least privilege at the point of use. Identity is all that signing in needs;
 * wallet:read is only worth asking for once there is a payout to address, and
 * CoinPay grants no payment scopes at all — see docs/architecture/auth.md.
 */
const LOGIN_SCOPES = ['openid', 'profile', 'email'];

function secret(): string {
  const s = env('AUTH_SECRET');
  if (!s) throw new Error('AUTH_SECRET is not configured');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** state + PKCE verifier ride in one signed, short-lived cookie. */
export function beginAuthorization(
  returnTo: string,
  origin = canonicalOrigin(),
): { url: string; cookie: string } {
  const clientId = env('COINPAY_CLIENT_ID');
  // Built from the host actually being served, and carried in the state cookie
  // so the token exchange presents the identical value. Every host the app
  // answers on must therefore be a registered redirect URI on the CoinPay side.
  const redirectUri = `${origin}${COINPAY_REDIRECT_PATH}`;
  if (!clientId) throw new Error('COINPAY_CLIENT_ID is not configured');

  const state = randomBytes(16).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = b64url(createHash('sha256').update(verifier).digest());

  const payload = b64url(JSON.stringify({ state, verifier, returnTo, redirectUri, ts: Date.now() }));
  const cookieValue = `${payload}.${sign(payload)}`;

  const url = new URL(`${ISSUER}/api/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', LOGIN_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  const secure = redirectUri.startsWith('https://') ? '; Secure' : '';
  return {
    url: url.toString(),
    cookie: `${COINPAY_STATE_COOKIE}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=600`,
  };
}

export function clearedStateCookie(): string {
  return `${COINPAY_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

type StatePayload = {
  state: string;
  verifier: string;
  returnTo: string;
  redirectUri: string;
  ts: number;
};

export function readState(cookieValue: string | undefined): StatePayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  if (!safeEqual(mac, sign(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as StatePayload;
    if (Date.now() - parsed.ts > 600_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

type TokenResponse = { access_token: string; refresh_token?: string; scope?: string };
type UserInfo = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
};

async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: env('COINPAY_CLIENT_ID') ?? '',
    client_secret: env('COINPAY_CLIENT_SECRET') ?? '',
    code_verifier: verifier,
  });
  const res = await fetch(`${ISSUER}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`coinpay token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const res = await fetch(`${ISSUER}/api/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`coinpay userinfo failed: ${res.status}`);
  return (await res.json()) as UserInfo;
}

/**
 * Complete the callback and resolve an actor.
 *
 * A CoinPay subject links to exactly one actor. When a signed-in actor is
 * present the identity is attached to them; otherwise an existing link is
 * followed, and only failing that is a new account created. Two accounts are
 * never merged because their email addresses happen to match.
 */
export async function completeAuthorization(
  code: string,
  verifier: string,
  redirectUri: string,
  currentActorId?: string,
): Promise<{ actor: Actor; created: boolean }> {
  const tokens = await exchangeCode(code, verifier, redirectUri);
  const info = await fetchUserInfo(tokens.access_token);
  if (!info.sub) throw new Error('coinpay userinfo returned no subject');

  const existing = await db().execute({
    sql: 'select actor_id from oauth_identities where provider = ? and subject = ?',
    args: ['coinpay', info.sub],
  });
  const linkedActorId = (existing.rows[0] as unknown as { actor_id: string } | undefined)?.actor_id;

  if (linkedActorId) {
    if (currentActorId && currentActorId !== linkedActorId) {
      throw new Error('coinpay_already_linked');
    }
    await db().execute({
      sql: `update oauth_identities
            set last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), scopes = ?
            where provider = 'coinpay' and subject = ?`,
      args: [tokens.scope ?? null, info.sub],
    });
    const actor = await actorById(linkedActorId);
    if (!actor) throw new Error('linked actor missing');
    return { actor, created: false };
  }

  const actor = currentActorId
    ? await actorById(currentActorId)
    : await createActorForIdentity(
        info.preferred_username ?? '',
        info.name ?? info.preferred_username ?? 'Contributor',
        info.email ?? null,
      );
  if (!actor) throw new Error('actor missing');

  await db().batch(
    [
      {
        sql: `insert into oauth_identities
                (provider, subject, actor_id, email, display_name, scopes, last_login_at)
              values ('coinpay', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        args: [
          info.sub,
          actor.id,
          info.email ?? null,
          info.name ?? null,
          tokens.scope ?? null,
        ],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'identity.link', 'oauth_identity', ?)`,
        args: [actor.id, info.sub],
      },
    ],
    'write',
  );

  return { actor, created: !currentActorId };
}

export async function linkedIdentities(actorId: string) {
  const r = await db().execute({
    sql: `select provider, display_name, email, linked_at, last_login_at
          from oauth_identities where actor_id = ? order by linked_at`,
    args: [actorId],
  });
  return r.rows as unknown as {
    provider: string;
    display_name: string | null;
    email: string | null;
    linked_at: string;
    last_login_at: string | null;
  }[];
}

export async function unlinkCoinpay(actorId: string): Promise<void> {
  // Historical bounty and tip records must survive an unlink, so only the
  // identity row goes; nothing that references it is cascaded away here.
  await db().execute({
    sql: `delete from oauth_identities where actor_id = ? and provider = 'coinpay'`,
    args: [actorId],
  });
}
