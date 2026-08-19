import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { db } from '@bufferoverride/db';
import { canonicalOrigin, rpIdFor } from './origin.ts';
import { actorById, type Actor } from './actors.ts';
import { isExpired, minutesFromNow } from './tokens.ts';

export const CHALLENGE_COOKIE = 'bo_webauthn';

// Origin is passed in per request rather than read from config: a credential
// registered on one host cannot be asserted on another, so both the expected
// origin and the rpID must track the host actually being served.
function fallbackOrigin(): string {
  return canonicalOrigin();
}

export function challengeCookie(handle: string, origin = fallbackOrigin()): string {
  const secure = origin.startsWith('https://') ? '; Secure' : '';
  return `${CHALLENGE_COOKIE}=${handle}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=300`;
}

async function storeChallenge(
  challenge: string,
  purpose: 'register' | 'authenticate',
  actorId?: string,
): Promise<string> {
  const handle = randomBytes(16).toString('base64url');
  await db().execute({
    sql: `insert into webauthn_challenges (handle, challenge, actor_id, purpose, expires_at)
          values (?, ?, ?, ?, ?)`,
    args: [handle, challenge, actorId ?? null, purpose, minutesFromNow(5)],
  });
  return handle;
}

async function takeChallenge(handle: string | undefined, purpose: string) {
  if (!handle) return null;
  const r = await db().execute({
    sql: 'select challenge, actor_id, purpose, expires_at from webauthn_challenges where handle = ?',
    args: [handle],
  });
  const row = r.rows[0] as unknown as
    | { challenge: string; actor_id: string | null; purpose: string; expires_at: string }
    | undefined;
  await db().execute({ sql: 'delete from webauthn_challenges where handle = ?', args: [handle] });
  if (!row || row.purpose !== purpose || isExpired(row.expires_at)) return null;
  return row;
}

export async function registrationOptions(actor: Actor, origin = fallbackOrigin()) {
  const existing = await db().execute({
    sql: 'select credential_id from passkeys where actor_id = ?',
    args: [actor.id],
  });

  const options = await generateRegistrationOptions({
    rpName: 'BufferOverride',
    rpID: rpIdFor(origin),
    userName: actor.username,
    userDisplayName: actor.display_name,
    attestationType: 'none',
    excludeCredentials: (existing.rows as unknown as { credential_id: string }[]).map((c) => ({
      id: c.credential_id,
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });

  const handle = await storeChallenge(options.challenge, 'register', actor.id);
  return { options, handle };
}

export async function verifyRegistration(
  actor: Actor,
  handle: string | undefined,
  response: Parameters<typeof verifyRegistrationResponse>[0]['response'],
  label?: string,
  origin = fallbackOrigin(),
): Promise<boolean> {
  const stored = await takeChallenge(handle, 'register');
  if (!stored || stored.actor_id !== actor.id) return false;

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpIdFor(origin),
  });
  if (!verification.verified || !verification.registrationInfo) return false;

  const { credential } = verification.registrationInfo;
  await db().batch(
    [
      {
        sql: `insert into passkeys (actor_id, credential_id, public_key, counter, transports, label)
              values (?, ?, ?, ?, ?, ?)`,
        args: [
          actor.id,
          credential.id,
          Buffer.from(credential.publicKey).toString('base64url'),
          credential.counter ?? 0,
          credential.transports ? JSON.stringify(credential.transports) : null,
          label ?? null,
        ],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'passkey.register', 'passkey', ?)`,
        args: [actor.id, credential.id],
      },
    ],
    'write',
  );
  return true;
}

/** Usernameless authentication: the credential itself identifies the actor. */
export async function authenticationOptions(origin = fallbackOrigin()) {
  const options = await generateAuthenticationOptions({
    rpID: rpIdFor(origin),
    userVerification: 'preferred',
  });
  const handle = await storeChallenge(options.challenge, 'authenticate');
  return { options, handle };
}

export async function verifyAuthentication(
  handle: string | undefined,
  response: Parameters<typeof verifyAuthenticationResponse>[0]['response'],
  origin = fallbackOrigin(),
): Promise<Actor | null> {
  const stored = await takeChallenge(handle, 'authenticate');
  if (!stored) return null;

  const r = await db().execute({
    sql: 'select actor_id, public_key, counter, transports from passkeys where credential_id = ?',
    args: [response.id],
  });
  const row = r.rows[0] as unknown as
    | { actor_id: string; public_key: string; counter: number; transports: string | null }
    | undefined;
  if (!row) return null;

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpIdFor(origin),
    credential: {
      id: response.id,
      publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
      counter: row.counter,
      transports: row.transports ? JSON.parse(row.transports) : undefined,
    },
  });
  if (!verification.verified) return null;

  await db().execute({
    sql: `update passkeys
          set counter = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          where credential_id = ?`,
    args: [verification.authenticationInfo.newCounter, response.id],
  });

  return actorById(row.actor_id);
}

export async function listPasskeys(actorId: string) {
  const r = await db().execute({
    sql: `select credential_id, label, created_at, last_used_at
          from passkeys where actor_id = ? order by created_at`,
    args: [actorId],
  });
  return r.rows as unknown as {
    credential_id: string;
    label: string | null;
    created_at: string;
    last_used_at: string | null;
  }[];
}
