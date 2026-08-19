import { env } from '@bufferoverride/db';

/**
 * Transactional email through Resend.
 *
 * With no API key configured the link is logged instead of sent, so local
 * development works without credentials. That is a loud fallback on purpose:
 * a production deploy with no key would otherwise look healthy while nobody
 * could ever sign in.
 */
export async function sendMagicLink(to: string, url: string): Promise<void> {
  const key = env('RESEND_API_KEY');
  const from = env('MAIL_FROM') ?? 'BufferOverride <login@bufferoverride.com>';

  if (!key) {
    console.warn(`[auth] RESEND_API_KEY unset — magic link for ${to} not sent: ${url}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: 'Your BufferOverride sign-in link',
      text: [
        'Sign in to BufferOverride:',
        '',
        url,
        '',
        'This link works once and expires in 15 minutes.',
        'If you did not ask for it, you can ignore this message.',
      ].join('\n'),
    }),
  });

  if (!res.ok) {
    console.error('[auth] resend rejected the message:', res.status, await res.text());
    throw new Error('email_send_failed');
  }

  // Log the provider id, never the address or the link: enough to trace a
  // delivery in Resend, not enough to sign in as anybody.
  const sent = (await res.json().catch(() => ({}))) as { id?: string };
  console.log(`[auth] magic link sent, resend id ${sent.id ?? 'unknown'}`);
}
