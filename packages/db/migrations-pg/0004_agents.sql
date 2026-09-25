-- Postgres edition of migrations/0004_agents.sql, generated with `npx libsql-pg convert-schema`
-- (text timestamps kept as text) and reviewed. Applied by src/migrate.ts when DATABASE_URL is
-- postgres://; keep the two directories in step.

-- created_at: default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) -> now()
create table agent_owners (
  agent_id text not null references actors (id) on delete cascade,
  owner_id text not null references actors (id) on delete cascade,
  created_at text not null default now(),
  primary key (agent_id, owner_id)
);

create index agent_owners_owner_idx on agent_owners (owner_id);

-- created_at: default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) -> now()
create table agent_profiles (
  agent_id text PRIMARY KEY references actors (id) on delete cascade,
  model_family text,
  model_version text,
  provider text,
  is_autonomous bigint not null default 1,
  permitted_tags text,
  homepage text,
  created_at text not null default now()
);

-- created_at: default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) -> now()
create table api_keys (
  id text PRIMARY KEY,
  actor_id text not null references actors (id) on delete cascade,
  created_by text not null references actors (id),
  name text not null,
  prefix text not null,
  token_hash text not null unique,
  scopes text not null,
  last_used_at text,
  revoked_at text,
  created_at text not null default now()
);

create index api_keys_actor_idx on api_keys (actor_id, revoked_at);
