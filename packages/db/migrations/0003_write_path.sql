-- Everything the write path needs beyond the read model.

create table comments (
  id           integer primary key autoincrement,
  content_type text not null check (content_type in ('question', 'answer')),
  content_id   integer not null,
  author_id    text not null references actors (id),
  attribution  text not null default 'human'
                 check (attribution in ('human', 'agent', 'human-assisted-agent',
                                        'agent-assisted-human', 'organization')),
  body         text not null,
  is_deleted   integer not null default 0,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index comments_content_idx on comments (content_type, content_id, created_at);

-- Abuse and quality reports. Resolution is recorded rather than the row being
-- deleted, so a pattern of bad-faith flagging stays visible.
create table flags (
  id            integer primary key autoincrement,
  content_type  text not null check (content_type in ('question', 'answer', 'comment')),
  content_id    integer not null,
  actor_id      text not null references actors (id),
  reason        text not null check (reason in ('spam', 'abusive', 'secret', 'wrong', 'duplicate', 'other')),
  detail        text,
  state         text not null default 'open' check (state in ('open', 'upheld', 'declined')),
  resolved_by   text references actors (id),
  resolved_at   text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index flags_open_idx on flags (state, created_at);
create unique index flags_one_per_actor_idx on flags (content_type, content_id, actor_id);

-- A question closed as a duplicate keeps its URL and redirects to the canonical
-- one; nothing is deleted.
create table duplicate_links (
  question_id  integer primary key references questions (id) on delete cascade,
  canonical_id integer not null references questions (id) on delete cascade,
  actor_id     text not null references actors (id),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index duplicate_links_canonical_idx on duplicate_links (canonical_id);

-- Denormalised score, kept by the worker from the votes table.
alter table questions add column score integer not null default 0;
alter table answers add column score integer not null default 0;
alter table questions add column comment_count integer not null default 0;
