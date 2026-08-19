-- Authentication: emailed magic link + passkey + CoinPay OAuth.
--
-- There are deliberately no passwords here, and therefore no password reset:
-- the emailed link already proves control of the address, and a reset flow
-- collapses back into "email them a link" anyway. A password would only add a
-- second, weaker secret to store.

alter table actors add column email text;
create unique index actors_email_idx on actors (email) where email is not null;

-- A pending sign-in. The token is stored hashed so a database read cannot be
-- replayed as a login, and consumption is single-use.
create table magic_links (
  id           integer primary key autoincrement,
  email        text not null,
  token_hash   text not null unique,
  expires_at   text not null,
  consumed_at  text,
  requested_ip text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index magic_links_email_idx on magic_links (email, created_at);

create table sessions (
  id           text primary key,
  actor_id     text not null references actors (id) on delete cascade,
  token_hash   text not null unique,
  user_agent   text,
  expires_at   text not null,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at text
);

create index sessions_actor_idx on sessions (actor_id, expires_at);

-- WebAuthn credentials. The public key is not a secret, but the credential id
-- is the lookup handle and must be unique platform-wide.
create table passkeys (
  id             integer primary key autoincrement,
  actor_id       text not null references actors (id) on delete cascade,
  credential_id  text not null unique,
  public_key     text not null,
  counter        integer not null default 0,
  transports     text,
  label          text,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at   text
);

create index passkeys_actor_idx on passkeys (actor_id);

-- A short-lived challenge, keyed by a cookie handle rather than by actor, so
-- it also covers a usernameless authentication attempt.
create table webauthn_challenges (
  handle     text primary key,
  challenge  text not null,
  actor_id   text references actors (id) on delete cascade,
  purpose    text not null check (purpose in ('register', 'authenticate')),
  expires_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- An external identity linked to an actor. One provider subject may be linked
-- to exactly one actor; merging two existing accounts is a separate, explicit
-- process and never happens just because two emails match.
create table oauth_identities (
  id            integer primary key autoincrement,
  provider      text not null,
  subject       text not null,
  actor_id      text not null references actors (id) on delete cascade,
  email         text,
  display_name  text,
  scopes        text,
  linked_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at text
);

create unique index oauth_identities_provider_subject_idx on oauth_identities (provider, subject);
create index oauth_identities_actor_idx on oauth_identities (actor_id);

-- Wallet addresses read from CoinPay under wallet:read. Private by default:
-- a payout destination is not public profile data.
create table coinpay_wallets (
  id          integer primary key autoincrement,
  actor_id    text not null references actors (id) on delete cascade,
  chain       text not null,
  address     text not null,
  is_public   integer not null default 0,
  synced_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create unique index coinpay_wallets_actor_chain_idx on coinpay_wallets (actor_id, chain, address);
