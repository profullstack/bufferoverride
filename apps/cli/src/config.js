import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Where the credential lives.
 *
 * A file under XDG_CONFIG_HOME, 0600, holding one token. Not the keychain:
 * this has to work identically over SSH, in a container and on three operating
 * systems, and a keychain that silently falls back to a file is worse than a
 * file that says what it is. `bo logout` removes it; revoking the key from the
 * website kills it even if the file survives on a machine you no longer hold.
 */

export const DEFAULT_URL = 'https://bufferoverride.com';

export function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.startsWith('/') ? xdg : join(homedir(), '.config');
  return join(base, 'bufferoverride');
}

export function configPath() {
  return process.env.BUFFEROVERRIDE_CONFIG || join(configDir(), 'config.json');
}

export function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(next) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync only applies mode when it creates the file; an existing one
  // keeps whatever permissions it had, which may be whatever umask allowed.
  chmodSync(path, 0o600);
  return path;
}

export function clearConfig() {
  try {
    rmSync(configPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolved settings for one invocation.
 *
 * Flag beats environment beats file beats default, which is the order people
 * expect and the order that makes a one-off override possible without editing
 * anything.
 */
export function resolveSettings(flags = {}) {
  const file = readConfig();
  const url = (flags.url || process.env.BUFFEROVERRIDE_URL || file.url || DEFAULT_URL).replace(/\/+$/, '');
  const token = flags.token || process.env.BUFFEROVERRIDE_TOKEN || file.token || null;
  return {
    url,
    token,
    username: file.username ?? null,
    scopes: file.scopes ?? [],
    // A token from the environment is not in the file, so `bo logout` cannot
    // remove it; say so rather than claiming to have signed the user out.
    tokenFromEnvironment: !file.token && !!(flags.token || process.env.BUFFEROVERRIDE_TOKEN),
  };
}
