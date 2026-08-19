import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  actorFromSessionToken,
  linkedIdentities,
  listPasskeys,
} from '@bufferoverride/auth';
import { Badge, Button } from '@bufferoverride/ui';
import { PasskeyManager } from '../_components/passkey-manager.tsx';
import { SettingsNav } from './_nav.tsx';
import styles from './settings.module.css';
import authStyles from '../_components/auth.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account', robots: { index: false, follow: false } };

export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; error?: string }>;
}) {
  const { welcome, error } = await searchParams;
  const jar = await cookies();
  const actor = await actorFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!actor) redirect('/login');

  const [identities, passkeys] = await Promise.all([
    linkedIdentities(actor.id),
    listPasskeys(actor.id),
  ]);
  const coinpay = identities.find((i) => i.provider === 'coinpay');

  return (
    <div className="wrap">
      <div className={styles.layout}>
        <SettingsNav current="/account" />

        <div className={styles.main}>
          <h1 className={styles.h1}>Account</h1>

          {welcome ? (
            <div className={authStyles.ok}>
              Welcome in. You are <strong>{actor.username}</strong>. Add a passkey below and you
              will not need the email next time.
            </div>
          ) : null}
          {error === 'already_linked' ? (
            <div className={authStyles.err}>
              That CoinPay account is already linked to a different BufferOverride account.
            </div>
          ) : null}

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>Identity</span>
              <span className={styles.spacer} />
              <a href={`/users/${actor.username}`} style={{ fontSize: 13 }}>
                View public profile
              </a>
            </div>
            <div className={styles.kv}>
              <span className={styles.k}>Username</span>
              <span className={styles.v}>{actor.username}</span>
              <span className={styles.k}>Email</span>
              <span className={styles.v}>{actor.email ?? 'not set'}</span>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>Passkeys</span>
              <Badge variant={passkeys.length ? 'verified' : 'outline'}>
                {passkeys.length ? `${passkeys.length} registered` : 'none yet'}
              </Badge>
            </div>
            <p className={styles.sectionBody}>
              A passkey is the fast way back in — Touch ID, Windows Hello, or a security key. There
              is no password to add, and the emailed link stays as the way back if you lose a
              device.
            </p>
            {passkeys.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {passkeys.map((p) => (
                  <div key={p.credential_id} style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    <span className="mono">{(p.label ?? 'passkey').slice(0, 48)}</span> · added{' '}
                    {p.created_at.slice(0, 10)}
                    {p.last_used_at ? ` · last used ${p.last_used_at.slice(0, 10)}` : ' · never used'}
                  </div>
                ))}
              </div>
            ) : null}
            <PasskeyManager count={passkeys.length} />
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>CoinPay</span>
              {coinpay ? (
                <Badge variant="verified">connected</Badge>
              ) : (
                <Badge variant="outline">not connected</Badge>
              )}
            </div>
            <p className={styles.sectionBody}>
              Connecting CoinPay proves who you are and, later, gives a bounty somewhere to pay out
              to. It grants no permission to move your money: BufferOverride never holds a key, and
              CoinPay issues no payment scope to begin with.
            </p>
            {coinpay ? (
              <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                linked {coinpay.linked_at.slice(0, 10)}
                {coinpay.email ? ` · ${coinpay.email}` : ''}
              </span>
            ) : (
              <Button href="/auth/coinpay/start?returnTo=/account" variant="outline">
                Connect CoinPay
              </Button>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>Sessions</span>
            </div>
            <p className={styles.sectionBody}>
              Signing out ends this browser&rsquo;s session. Your passkeys and linked accounts are
              unaffected.
            </p>
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                className={authStyles.alt}
                style={{ width: 'auto', padding: '0 16px' }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
