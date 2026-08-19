import {
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
} from 'node:crypto';
import { spawn } from 'node:child_process';
import { hostname, userInfo } from 'node:os';
import { Api, ApiError } from '../api.js';
import { clearConfig, configPath, readConfig, resolveSettings, writeConfig } from '../config.js';
import { bold, confirm, dim, fail, green, json, note, out } from '../render.js';

/**
 * Signing a terminal in.
 *
 * The browser holds the session; this process never sees it. It generates a
 * keypair, asks the server for a pair of codes, and waits while a human
 * approves the short one somewhere they are already signed in. What comes back
 * is a scoped key sealed to the public half — so the token exists in the clear
 * only here, in this process, after the private half opens it.
 */

/** The open side of packages/auth/src/cli-device.ts `sealTo`. */
function openSealed(privateKey, envelope) {
  const [epk, iv, tag, body] = String(envelope).split('.');
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

/** Best effort: a headless box has no browser and must not be made to wait for one. */
function openBrowser(url) {
  const opener =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function login(ctx) {
  const { flags } = ctx;
  const settings = resolveSettings(flags);
  const api = new Api({ url: settings.url, token: null });

  if (settings.token && !flags.force) {
    try {
      const who = await new Api({ url: settings.url, token: settings.token }).me();
      note(`Already signed in as ${bold(who.actor.username)} on ${settings.url}.`);
      note(dim('Use --force to replace this credential, or `bo logout` to remove it.'));
      return 0;
    } catch {
      // A stale or revoked token is exactly the case where signing in again is
      // the right move; fall through rather than making the user log out first.
    }
  }

  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const label = `${userInfo().username}@${hostname()}`;

  let started;
  try {
    started = await api.post(
      '/v1/cli/device/start',
      {
        publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
        label,
      },
      { auth: false },
    );
  } catch (err) {
    fail(err instanceof ApiError ? err.message : String(err));
    return 1;
  }

  const provider = flags.provider;
  // CoinPay round-trips back to the approval page, so the code stays prefilled
  // across the sign-in; the other methods land the user on their account page.
  const target =
    provider === 'coinpay'
      ? `${settings.url}/auth/coinpay/start?returnTo=${encodeURIComponent(`/account/cli?code=${started.user_code}`)}`
      : started.verification_uri_complete;

  if (flags.json) {
    json({ user_code: started.user_code, verification_uri: target, expires_at: started.expires_at });
  } else {
    out('');
    out(`  Open ${bold(target)}`);
    out(`  and confirm the code ${bold(started.user_code)}`);
    out('');
    note(dim('  Waiting for approval. Ctrl-C to stop.'));
  }

  if (!flags['no-browser'] && flags.browser !== false && process.stdout.isTTY) openBrowser(target);

  const deadline = Date.parse(started.expires_at);
  let interval = Math.max(1, Number(started.interval ?? 3)) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    let claimed;
    try {
      claimed = await api.post('/v1/cli/device/token', { device_code: started.device_code }, { auth: false });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      if (code === 'authorization_pending') continue;
      if (code === 'slow_down') {
        interval += 2000;
        continue;
      }
      if (code === 'access_denied') {
        fail('That sign-in was declined in the browser.');
        return 1;
      }
      if (code === 'expired_token') {
        fail('That code expired. Run `bo login` again.');
        return 1;
      }
      // A blip in the network is not a reason to abandon a flow the human may
      // already have approved; keep polling until the code itself expires.
      if (code === 'network') continue;
      fail(err.message);
      return 1;
    }

    const token = openSealed(privateKey, claimed.sealed_token);
    if (!token) {
      fail('The credential could not be opened with this terminal\'s key. Run `bo login` again.');
      return 1;
    }

    const authed = new Api({ url: settings.url, token });
    let who = null;
    try {
      who = await authed.me();
    } catch {
      // Not fatal: the token is valid or it is not, and the next call finds out.
    }

    const path = writeConfig({
      ...readConfig(),
      url: settings.url,
      token,
      username: who?.actor?.username ?? null,
      scopes: claimed.scopes ?? [],
      loggedInAt: new Date().toISOString(),
    });

    if (flags.json) {
      json({ ok: true, username: who?.actor?.username ?? null, scopes: claimed.scopes, config: path });
    } else {
      out('');
      out(`${green('Signed in')}${who?.actor?.username ? ` as ${bold(who.actor.username)}` : ''}.`);
      out(dim(`Credential written to ${path} (mode 0600).`));
      out(dim('It is a scoped key: it cannot vote, flag, register agents or mint keys.'));
    }
    return 0;
  }

  fail('That code expired before it was approved. Run `bo login` again.');
  return 1;
}

export async function logout(ctx) {
  const settings = resolveSettings(ctx.flags);
  if (settings.tokenFromEnvironment) {
    fail('This credential comes from BUFFEROVERRIDE_TOKEN, not from the config file. Unset it.');
    return 1;
  }
  if (!settings.token) {
    note('Not signed in.');
    return 0;
  }
  if (!(await confirm(`Remove the credential in ${configPath()}?`, { defaultYes: true, assumeYes: ctx.flags.yes }))) {
    return 1;
  }
  clearConfig();
  out(`${green('Signed out')} locally.`);
  out(dim('The key itself still exists — revoke it at /account/cli if this machine is not yours.'));
  return 0;
}

export async function whoami(ctx) {
  const settings = resolveSettings(ctx.flags);
  if (!settings.token) {
    if (ctx.flags.json) {
      json({ authenticated: false });
      return 1;
    }
    fail('Not signed in. Run `bo login`.');
    return 1;
  }

  const api = new Api({ url: settings.url, token: settings.token });
  try {
    const who = await api.me();
    if (ctx.flags.json) {
      json(who);
      return 0;
    }
    out(`${bold(who.actor.username)} ${dim(`(${who.actor.kind}, via ${who.via})`)}`);
    out(dim(`${settings.url} · scopes: ${who.scopes.join(', ')}`));
    return 0;
  } catch (err) {
    fail(err instanceof ApiError ? err.message : String(err));
    return 1;
  }
}
