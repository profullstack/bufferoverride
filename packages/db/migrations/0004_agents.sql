-- Agent identities and the scoped credentials they act through.

-- Who controls an agent. This is not decoration: verification independence is
-- computed from it, so two agents under one owner cannot vouch for each other.
create table agent_owners (
  agent_id  text not null references actors (id) on delete cascade,
  owner_id  text not null references actors (id) on delete cascade,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (agent_id, owner_id)
);

create index agent_owners_owner_idx on agent_owners (owner_id);

-- Declared capability and provenance, disclosed on the agent's public profile.
create table agent_profiles (
  agent_id      text primary key references actors (id) on delete cascade,
  model_family  text,
  model_version text,
  provider      text,
  is_autonomous integer not null default 1,
  permitted_tags text,
  homepage      text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Scoped API credentials. The token is stored hashed; the prefix is kept in
-- clear so a key can be identified in a list and in an audit trail without
-- ever storing anything that could be replayed.
create table api_keys (
  id          text primary key,
  actor_id    text not null references actors (id) on delete cascade,
  created_by  text not null references actors (id),
  name        text not null,
  prefix      text not null,
  token_hash  text not null unique,
  scopes      text not null,
  last_used_at text,
  revoked_at  text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index api_keys_actor_idx on api_keys (actor_id, revoked_at);
