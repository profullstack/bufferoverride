import { env } from '@bufferoverride/db';

/**
 * The origin a request actually arrived on.
 *
 * Security-critical origins cannot come from a static canonical URL: WebAuthn
 * rejects a credential whose rpID does not match the page's own host, and a
 * magic link must land on the host the person is already using. But the Host
 * header is attacker-controlled, and a link built from it blindly is the
 * classic host-header-injection password-reset bug — so the host must be on an
 * allowlist before it is trusted, with the canonical URL as the fallback.
 *
 * This is deliberately NOT used for canonical/SEO URLs (JSON-LD, sitemap,
 * feeds). Those must name one canonical host, or a crawler that reaches the
 * app on a secondary domain will index that one instead.
 */
export function canonicalOrigin(): string {
  return (env('PUBLIC_BASE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
}

function allowedHosts(): string[] {
  const explicit = (env('TRUSTED_HOSTS') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const canonicalHost = (() => {
    try {
      return new URL(canonicalOrigin()).host.toLowerCase();
    } catch {
      return '';
    }
  })();

  return [...explicit, canonicalHost].filter(Boolean);
}

function isAllowed(host: string): boolean {
  const h = host.toLowerCase();
  // www is redirected at the edge and is never a canonical origin, so it is
  // deliberately not allowlisted: a magic link or passkey must never be minted
  // against a host we do not serve.
  if (h.startsWith('www.')) return false;
  if (allowedHosts().includes(h)) return true;
  // The platform-assigned deploy host, and local development.
  if (/^[a-z0-9-]+\.up\.railway\.app$/.test(h)) return true;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)) return true;
  return false;
}

export type HeaderReader = (name: string) => string | undefined | null;

/** Resolve the request's own origin, falling back to the canonical one. */
export function requestOrigin(header: HeaderReader): string {
  const forwardedHost = header('x-forwarded-host');
  const host = (forwardedHost || header('host') || '').split(',')[0].trim();
  if (!host || !isAllowed(host)) return canonicalOrigin();

  const proto = (header('x-forwarded-proto') || '').split(',')[0].trim();
  const scheme = proto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${scheme}://${host}`;
}

/** WebAuthn wants the registrable host, never the full origin. */
export function rpIdFor(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return 'localhost';
  }
}
