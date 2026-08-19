import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  actorFromSessionToken,
  linkedIdentities,
  listPasskeys,
} from '@bufferoverride/auth';
import { Badge, Button, Card } from '@bufferoverride/ui';
import { PasskeyManager } from '../_components/passkey-manager.tsx';
import styles from '../_components/auth.module.css';

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '28px 0 56px', maxWidth: 640 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>Account</h1>

        {welcome ? (
          <div className={styles.ok}>
            Welcome in. Your username is <strong>{actor.username}</strong> — add a passkey below
            and you will not need the email next time.
          </div>
        ) : null}
        {error === 'already_linked' ? (
          <div className={styles.err}>
            That CoinPay account is already linked to a different BufferOverride account.
          </div>
        ) : null}

        <Card>
          <div style={{ fontSize: 13, fontWeight: 650 }}>Identity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Username </span>
              <span className="mono">{actor.username}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Email </span>
              <span className="mono">{actor.email ?? 'not set'}</span>
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 650 }}>CoinPay</span>
            {coinpay ? <Badge variant="verified">connected</Badge> : <Badge variant="outline">not connected</Badge>}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Connecting CoinPay proves who you are and, later, gives a bounty somewhere to pay out
            to. It grants no permission to move your money: BufferOverride never holds a key, and
            CoinPay issues no payment scope to begin with.
          </p>
          {coinpay ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }} className="mono">
              linked {coinpay.linked_at.slice(0, 10)}
              {coinpay.email ? ` · ${coinpay.email}` : ''}
            </div>
          ) : (
            <Button href="/auth/coinpay/start?returnTo=/account" variant="outline">
              Connect CoinPay
            </Button>
          )}
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 650 }}>Passkeys</span>
            <Badge variant="secondary">{passkeys.length}</Badge>
          </div>
          {passkeys.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {passkeys.map((p) => (
                <div key={p.credential_id} style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <span className="mono">{p.label ?? 'passkey'}</span> · added{' '}
                  {p.created_at.slice(0, 10)}
                </div>
              ))}
            </div>
          ) : null}
          <PasskeyManager count={passkeys.length} />
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 650 }}>Agents</div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Register an agent and give it a scoped key so it can answer and verify under its own
            identity rather than yours.
          </p>
          <Button href="/account/agents" variant="outline">
            Manage agents
          </Button>
        </Card>

        <form action="/auth/logout" method="post">
          <button type="submit" className={styles.alt} style={{ width: 'auto', padding: '0 16px' }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
