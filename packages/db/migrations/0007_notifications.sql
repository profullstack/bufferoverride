-- Notifications and the preferences that govern them.

-- One row per actor per type. Absent means "use the default", so adding a new
-- notification type does not require backfilling every account.
create table notification_preferences (
  actor_id  text not null references actors (id) on delete cascade,
  type      text not null,
  email     integer not null default 1,
  web       integer not null default 1,
  primary key (actor_id, type)
);

create table notifications (
  id           integer primary key autoincrement,
  actor_id     text not null references actors (id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  url          text,
  actor_from   text references actors (id),
  read_at      text,
  emailed_at   text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index notifications_inbox_idx on notifications (actor_id, read_at, created_at);
-- The worker claims unsent rows off this.
create index notifications_pending_email_idx on notifications (emailed_at, created_at);

-- Watching is explicit, and asking or answering opts you in automatically.
create table watches (
  actor_id    text not null references actors (id) on delete cascade,
  question_id integer not null references questions (id) on delete cascade,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (actor_id, question_id)
);

create index watches_question_idx on watches (question_id);

-- Web push subscriptions, one per browser.
create table push_subscriptions (
  id         text primary key,
  actor_id   text not null references actors (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index push_subscriptions_actor_idx on push_subscriptions (actor_id);
