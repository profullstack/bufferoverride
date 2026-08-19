# Authentication

> Supersedes §6.5 of [the PRD](../PRD.md), which specified email/password plus a
> `credentials` table.

## Decision

**Emailed magic link, passkeys, and CoinPay OAuth. No passwords.**

There is no password field, so there is no password reset, no "forgot password"
page, no strength rules, and no credential store to get wrong. The emailed link
already proves control of the address, and proving the address *is* the account.
A password would add a second, weaker secret whose recovery path collapses back
into "email them a link" anyway — so it only ever adds attack surface between
the user and the thing that was already sufficient.

This follows the house pattern used across Profullstack apps.

## The three ways in

| Method | Role |
|---|---|
| Magic link | The way in from nothing. Doubles as registration. |
| Passkey | Added afterwards; becomes the fast path. |
| CoinPay OAuth | Identity, and later a payout destination. |

**The magic link doubles as registration.** An unknown address creates the
account rather than being turned away to find a sign-up form. A page called
*sign up* still exists, because a mechanism with no name reads to a new visitor
as "this site has no accounts" — but `/login` and `/signup` share one
implementation (`SignInPanels`) and differ only in wording, so they cannot drift.

## Rules the implementation holds to

- **Never disclose whether an address has an account.** `/v1/auth/magic` answers
  "if that address can receive mail, a link is on its way" for a known address,
  an unknown one, a malformed one, and a rate-limited one alike. Anything else
  turns the endpoint into a way to enumerate who has registered.
- **Links are single-use and short-lived.** 15 minutes, and consumption is a
  conditional update, so two concurrent uses cannot both win.
- **Tokens are stored hashed.** Magic links and sessions keep a SHA-256 of the
  token, so a database read is not a usable credential.
- **One CoinPay subject links to exactly one actor.** Two accounts are never
  merged because their email addresses match; that requires an explicit process.
- **Unlinking CoinPay does not delete history.** Only the identity row goes.
- **Passkey authentication is usernameless** — the credential identifies the
  actor, so there is no "who are you" step before the prompt.

## CoinPay scopes

BufferOverride requests `openid profile email` to sign in, and nothing more.

`wallet:read` is available and is worth requesting only once there is a payout
to address. **CoinPay grants no payment scopes at all** — its authorization
server defines exactly `openid`, `profile`, `email`, `did` and `wallet:read`,
and `validateScopes` filters a request down to the client's registered list. So
connecting CoinPay here cannot authorize a payment, and the PRD's bounty and tip
flows (§7.6, §7.7) have no rail behind them yet. That is an open question for
CoinPayPortal, not something this app can configure around.

## Registering the OAuth client

The client is created from CoinPay's developer UI at
`https://coinpayportal.com/dashboard/oauth`, which stores the bcrypt hash *and*
the retrievable encrypted copy of the secret. Redirect URIs:

```text
https://bufferoverride.com/auth/coinpay/callback
https://bufferoverride-production.up.railway.app/auth/coinpay/callback
http://localhost:3000/auth/coinpay/callback
```

Then set `COINPAY_CLIENT_ID` and `COINPAY_CLIENT_SECRET`. Until they are set,
`/auth/coinpay/start` redirects to `/login?error=coinpay_unconfigured` rather
than failing obscurely.

## Environment

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | HMAC key for the signed OAuth state cookie. Required. |
| `COINPAY_CLIENT_ID` / `COINPAY_CLIENT_SECRET` | CoinPay OAuth client |
| `RESEND_API_KEY` | Sends the magic link. **Without it the link is logged, not sent** — the loud fallback exists so local development needs no credentials, but a production deploy without it means nobody can sign in by email. |
| `MAIL_FROM` | Sender identity, defaults to `login@bufferoverride.com` |

## Session

An opaque 32-byte token in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie for 30
days. Lax rather than Strict is deliberate: the magic link and the OAuth
callback are both top-level navigations arriving from another origin, and Strict
would drop the cookie on exactly those hops.
