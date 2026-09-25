-- Postgres edition of migrations/0008_cli.sql, generated with `npx libsql-pg convert-schema`
-- (text timestamps kept as text) and reviewed. Applied by src/migrate.ts when DATABASE_URL is
-- postgres://; keep the two directories in step.

-- created_at: default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) -> now()
create table cli_authorizations (
  device_hash text PRIMARY KEY,
  user_code text not null unique,
  label text,
  public_key text not null,
  actor_id text references actors (id) on delete cascade,
  key_id text references api_keys (id) on delete cascade,
  token_cipher text,
  approved_at text,
  denied_at text,
  expires_at text not null,
  created_at text not null default now()
);

create index cli_authorizations_expiry_idx on cli_authorizations (expires_at);
