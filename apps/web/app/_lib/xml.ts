import { env } from '@bufferoverride/db';

/** Escape for XML text and attribute content. Never interpolate raw content. */
export function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function baseUrl(): string {
  return (env('PUBLIC_BASE_URL') ?? 'https://bufferoverride.com').replace(/\/$/, '');
}

export function rfc822(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}
