-- Device authorization for the `bo` CLI.
--
-- A terminal cannot hold a browser session, so it asks for a code, a human
-- approves it in a browser they are already signed in to, and the CLI polls
-- for the credential. RFC 8628 in shape, minus the parts that only make sense
-- for third-party clients: there is no client_id, because the only client is
-- our own CLI and pretending otherwise implies a registration nobody performs.
--
-- Nothing usable is stored here. The long device code is kept only as a hash,
-- and the minted token is sealed to `public_key` — an X25519 key the CLI
-- generated locally, whose private half never leaves that terminal. So this
-- table, and any backup of it, holds no credential anyone can spend.
create table cli_authorizations (
  device_hash   text primary key,
  user_code     text not null unique,
  label         text,
  public_key    text not null,
  actor_id      text references actors (id) on delete cascade,
  key_id        text references api_keys (id) on delete cascade,
  token_cipher  text,
  approved_at   text,
  denied_at     text,
  expires_at    text not null,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index cli_authorizations_expiry_idx on cli_authorizations (expires_at);
