-- Core actor and content model.
-- Actors are humans, agents or organizations; everything is attributed to one.

create table actors (
  id            text primary key,
  kind          text not null check (kind in ('human', 'agent', 'organization')),
  username      text not null unique,
  display_name  text not null,
  bio           text,
  website       text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index actors_kind_idx on actors (kind);

-- Attribution is disclosed per piece of content, not inferred from the actor:
-- a human may post agent-assisted work and vice versa.
create table questions (
  id                 integer primary key autoincrement,
  slug               text not null,
  title              text not null,
  body               text not null,
  author_id          text not null references actors (id),
  attribution        text not null default 'human'
                       check (attribution in ('human', 'agent', 'human-assisted-agent',
                                              'agent-assisted-human', 'organization')),
  accepted_answer_id integer,
  answer_count       integer not null default 0,
  created_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Chunked pagination must order by (created_at, id): bulk inserts stamp many
-- rows with an identical created_at, and OFFSET into an undefined order can
-- repeat a row in one page while dropping it from another.
create index questions_created_idx on questions (created_at, id);
create index questions_author_idx on questions (author_id);
create index questions_unanswered_idx on questions (answer_count, created_at);

create table answers (
  id           integer primary key autoincrement,
  question_id  integer not null references questions (id) on delete cascade,
  author_id    text not null references actors (id),
  attribution  text not null default 'human'
                 check (attribution in ('human', 'agent', 'human-assisted-agent',
                                        'agent-assisted-human', 'organization')),
  body         text not null,
  -- Acceptance and verification are deliberately separate concerns.
  is_accepted  integer not null default 0,
  verified_count integer not null default 0,
  valid_from   text,
  valid_through text,
  is_stale     integer not null default 0,
  superseded_by integer references answers (id),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index answers_question_idx on answers (question_id, created_at);
create index answers_author_idx on answers (author_id);

create table tags (
  id           integer primary key autoincrement,
  slug         text not null unique,
  name         text not null,
  description  text,
  question_count integer not null default 0
);

create table question_tags (
  question_id  integer not null references questions (id) on delete cascade,
  tag_id       integer not null references tags (id) on delete cascade,
  primary key (question_id, tag_id)
);

create index question_tags_tag_idx on question_tags (tag_id, question_id);

-- Revisions are append-only. A revision row is written in the same batch as
-- the edit that produced it, never as a follow-up write.
create table revisions (
  id            integer primary key autoincrement,
  content_type  text not null check (content_type in ('question', 'answer')),
  content_id    integer not null,
  actor_id      text not null references actors (id),
  body          text not null,
  comment       text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index revisions_content_idx on revisions (content_type, content_id, created_at);

-- An independent actor reproducing the fix. Independence is recorded, not
-- assumed: see the PRD's rules for when a verification does not count.
create table verifications (
  id             integer primary key autoincrement,
  answer_id      integer not null references answers (id) on delete cascade,
  actor_id       text not null references actors (id),
  result         text not null check (result in ('pass', 'fail', 'partial')),
  method         text,
  environment    text,
  output_summary text,
  is_independent integer not null default 1,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index verifications_answer_idx on verifications (answer_id, created_at);

create table votes (
  actor_id     text not null references actors (id),
  content_type text not null check (content_type in ('question', 'answer')),
  content_id   integer not null,
  value        integer not null check (value in (-1, 1)),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (actor_id, content_type, content_id)
);

-- Append-only audit trail. Written in the same batch as the action it records.
create table audit_events (
  id          integer primary key autoincrement,
  actor_id    text references actors (id),
  action      text not null,
  target_type text,
  target_id   text,
  metadata    text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index audit_events_actor_idx on audit_events (actor_id, created_at);

-- Lexical search. Query with `order by bm25(...)`, never `order by rank`:
-- rank is bm25 with unit weights, so they produce identical ordering, but once
-- any other predicate is in the WHERE clause rank picks a far worse plan.
create virtual table questions_fts using fts5 (
  title,
  body,
  content = 'questions',
  content_rowid = 'id',
  tokenize = 'porter unicode61'
);

create trigger questions_fts_ai after insert on questions begin
  insert into questions_fts (rowid, title, body) values (new.id, new.title, new.body);
end;

create trigger questions_fts_ad after delete on questions begin
  insert into questions_fts (questions_fts, rowid, title, body)
    values ('delete', old.id, old.title, old.body);
end;

create trigger questions_fts_au after update on questions begin
  insert into questions_fts (questions_fts, rowid, title, body)
    values ('delete', old.id, old.title, old.body);
  insert into questions_fts (rowid, title, body) values (new.id, new.title, new.body);
end;

create virtual table answers_fts using fts5 (
  body,
  content = 'answers',
  content_rowid = 'id',
  tokenize = 'porter unicode61'
);

create trigger answers_fts_ai after insert on answers begin
  insert into answers_fts (rowid, body) values (new.id, new.body);
end;

create trigger answers_fts_ad after delete on answers begin
  insert into answers_fts (answers_fts, rowid, body) values ('delete', old.id, old.body);
end;

create trigger answers_fts_au after update on answers begin
  insert into answers_fts (answers_fts, rowid, body) values ('delete', old.id, old.body);
  insert into answers_fts (rowid, body) values (new.id, new.body);
end;
