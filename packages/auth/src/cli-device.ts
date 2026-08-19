import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { db } from '@bufferoverride/db';
import { createApiKey, type Scope } from './api-keys.ts';
import { hashToken, isExpired, minutesFromNow, newToken } from './tokens.ts';

/**
 * Device authorization for the `bo` CLI.
 *
 * A terminal has no browser session and must not be handed one. So the CLI
 * asks for a pair of codes, the human approves the short one in a browser they
 * are already signed in to, and the CLI polls with the long one until the
 * credential comes back.
 *
 * Nothing usable is written to this table. The long code is stored only as a
 * hash, and the minted token is sealed to an X25519 public key the CLI
 * generated locally — the matching private key never leaves the terminal, so
 * neither this table nor a backup of it yields a credential anybody can spend.
 * The row is deleted on the first poll that claims it, either way.
 */

/** What a CLI key may do. Everything a *key* may ever do — see approve below. */
export const CLI_SCOPES: Scope[] = [
  'read',
  'write:questions',
  'write:answers',
  'write:verifications',
  'write:comments',
];

/** Codes a human reads off one screen and types into another. No 0/O, 1/I/L. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const TTL_MINUTES = 10;
export const POLL_INTERVAL_SECONDS = 3;

export type DeviceStart = {
  deviceCode: string;
  userCode: string;
  expiresAt: string;
  intervalSeconds: number;
};

export type DeviceRequest = {
  userCode: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  approved: boolean;
  denied: boolean;
};

function userCode(): string {
  const chars = [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/**
 * Seal a short string to an X25519 public key.
 *
 * Ephemeral-static ECDH, HKDF-SHA256, AES-256-GCM. The sender keeps no state:
 * everything the recipient needs travels in the envelope, and the sender's
 * ephemeral private key is discarded with the stack frame.
 */
export function sealTo(recipientSpkiB64: string, plaintext: string): string {
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
    (ephemeral.publicKey as KeyObject).export({ format: 'der', type: 'spki' }).toString('base64url'),
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

/** Only used by tests here; the CLI carries its own copy of the open side. */
export function openSealed(privateKey: KeyObject, envelope: string): string | null {
  const [epk, iv, tag, body] = envelope.split('.');
  if (!epk || !iv || !tag || !body) return null;
  try {
    const shared = diffieHellman({
      privateKey,
      publicKey: createPublicKey({ key: Buffer.from(epk, 'base64url'), format: 'der', type: 'spki' }),
    });
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'bo-cli-token', 32));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** A public key we cannot import is a client bug, and must not reach the DB. */
export function isSealableKey(spkiB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(spkiB64, 'base64url'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'x25519';
  } catch {
    return false;
  }
}

/** Expired rows are cleared opportunistically; nothing else sweeps this table. */
async function sweep(): Promise<void> {
  await db()
    .execute({ sql: 'delete from cli_authorizations where expires_at < ?', args: [new Date().toISOString()] })
    .catch(() => {});
}

export async function startDeviceAuthorization(input: {
  publicKey: string;
  label?: string;
}): Promise<DeviceStart> {
  await sweep();

  const deviceCode = newToken(32);
  const expiresAt = minutesFromNow(TTL_MINUTES);

  // A collision on the short code inside its ten-minute window is unlikely but
  // possible; retry rather than hand two terminals the same code.
  for (let attempt = 0; ; attempt++) {
    const code = userCode();
    try {
      await db().execute({
        sql: `insert into cli_authorizations (device_hash, user_code, label, public_key, expires_at)
              values (?, ?, ?, ?, ?)`,
        args: [hashToken(deviceCode), code, input.label?.slice(0, 80) ?? null, input.publicKey, expiresAt],
      });
      return { deviceCode, userCode: code, expiresAt, intervalSeconds: POLL_INTERVAL_SECONDS };
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
}

/** Humans type these in lower case and without the dash. Accept both. */
export function normalizeUserCode(input: string): string {
  const bare = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare;
}

export async function findDeviceRequest(code: string): Promise<DeviceRequest | null> {
  const r = await db().execute({
    sql: `select user_code, label, created_at, expires_at, approved_at, denied_at
          from cli_authorizations where user_code = ?`,
    args: [normalizeUserCode(code)],
  });
  const row = r.rows[0] as unknown as
    | {
        user_code: string;
        label: string | null;
        created_at: string;
        expires_at: string;
        approved_at: string | null;
        denied_at: string | null;
      }
    | undefined;
  if (!row || isExpired(row.expires_at)) return null;
  return {
    userCode: row.user_code,
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    approved: !!row.approved_at,
    denied: !!row.denied_at,
  };
}

/**
 * Approve a waiting terminal, as the signed-in human.
 *
 * The key is minted against the human's own actor, so the CLI acts as them —
 * but it is a *key*, and so inherits every restriction keys have: it cannot
 * vote, flag, register an agent or mint another key. A stolen laptop therefore
 * does not become a stolen account, and revoking one terminal is one row.
 */
export async function approveDeviceRequest(
  code: string,
  actorId: string,
  scopes: Scope[] = CLI_SCOPES,
): Promise<'ok' | 'not_found' | 'already'> {
  const normalized = normalizeUserCode(code);
  const r = await db().execute({
    sql: `select label, public_key, expires_at, approved_at, denied_at
          from cli_authorizations where user_code = ?`,
    args: [normalized],
  });
  const row = r.rows[0] as unknown as
    | {
        label: string | null;
        public_key: string;
        expires_at: string;
        approved_at: string | null;
        denied_at: string | null;
      }
    | undefined;
  if (!row || isExpired(row.expires_at)) return 'not_found';
  if (row.approved_at || row.denied_at) return 'already';

  const key = await createApiKey({
    actorId,
    createdBy: actorId,
    name: `cli · ${row.label ?? 'terminal'}`.slice(0, 60),
    scopes,
  });

  await db().execute({
    sql: `update cli_authorizations
          set actor_id = ?, key_id = ?, token_cipher = ?,
              approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          where user_code = ? and approved_at is null and denied_at is null`,
    args: [actorId, key.id, sealTo(row.public_key, key.token), normalized],
  });
  return 'ok';
}

export async function denyDeviceRequest(code: string): Promise<void> {
  await db().execute({
    sql: `update cli_authorizations set denied_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          where user_code = ? and approved_at is null`,
    args: [normalizeUserCode(code)],
  });
}

export type ClaimResult =
  | { status: 'pending' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'ok'; sealed: string; scopes: Scope[] };

export async function claimDeviceToken(deviceCode: string): Promise<ClaimResult> {
  const hash = hashToken(deviceCode);
  const r = await db().execute({
    sql: `select token_cipher, approved_at, denied_at, expires_at, key_id
          from cli_authorizations where device_hash = ?`,
    args: [hash],
  });
  const row = r.rows[0] as unknown as
    | {
        token_cipher: string | null;
        approved_at: string | null;
        denied_at: string | null;
        expires_at: string;
        key_id: string | null;
      }
    | undefined;

  if (!row) return { status: 'expired' };

  const drop = () =>
    db().execute({ sql: 'delete from cli_authorizations where device_hash = ?', args: [hash] });

  if (row.denied_at) {
    await drop();
    return { status: 'denied' };
  }
  if (isExpired(row.expires_at)) {
    await drop();
    return { status: 'expired' };
  }
  if (!row.approved_at || !row.token_cipher) return { status: 'pending' };

  const scopeRow = row.key_id
    ? ((await db().execute({ sql: 'select scopes from api_keys where id = ?', args: [row.key_id] }))
        .rows[0] as unknown as { scopes: string } | undefined)
    : undefined;

  // One shot. The row goes now, so a replayed poll cannot re-deliver the key.
  await drop();

  return {
    status: 'ok',
    sealed: row.token_cipher,
    scopes: (scopeRow?.scopes.split(' ') as Scope[]) ?? CLI_SCOPES,
  };
}
