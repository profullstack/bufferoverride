-- Reputation and moderation.
--
-- Reputation is derived, never incremented in place: it is recomputed from the
-- events that earned it, so a reversed vote or a deleted answer takes its
-- points with it and there is no drifting counter to reconcile.

alter table actors add column reputation integer not null default 0;
alter table actors add column reputation_computed_at text;

create table actor_tag_reputation (
  actor_id   text not null references actors (id) on delete cascade,
  tag_id     integer not null references tags (id) on delete cascade,
  reputation integer not null default 0,
  primary key (actor_id, tag_id)
);

create index actor_tag_reputation_tag_idx on actor_tag_reputation (tag_id, reputation);

-- Moderation outcomes are recorded rather than applied destructively: content
-- is hidden, and the row explaining why is permanent and appealable.
create table moderation_actions (
  id           integer primary key autoincrement,
  content_type text not null check (content_type in ('question', 'answer', 'comment')),
  content_id   integer not null,
  actor_id     text not null references actors (id),
  action       text not null check (action in ('hide', 'restore', 'lock', 'unlock')),
  reason       text,
  flag_id      integer references flags (id),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index moderation_actions_content_idx on moderation_actions (content_type, content_id, created_at);

alter table questions add column is_hidden integer not null default 0;
alter table answers add column is_hidden integer not null default 0;
alter table questions add column is_locked integer not null default 0;
