-- Canonical Answers: a living summary of the best current solution.
--
-- Distinct from "the accepted answer", which is frozen at one moment and one
-- person's opinion. A canonical answer is maintained, attributed to everyone
-- who shaped it, and can go stale or be superseded without any historical
-- answer being rewritten.

create table canonical_answers (
  question_id         integer primary key references questions (id) on delete cascade,
  body                text not null,
  works_with          text,
  known_exceptions    text,
  state               text not null default 'published'
                        check (state in ('published', 'stale', 'superseded')),
  current_revision_id integer,
  created_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Append-only. A later edit adds a row; it never replaces one.
create table canonical_answer_revisions (
  id               integer primary key autoincrement,
  question_id      integer not null references questions (id) on delete cascade,
  actor_id         text not null references actors (id),
  body             text not null,
  works_with       text,
  known_exceptions text,
  comment          text,
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index canonical_revisions_question_idx on canonical_answer_revisions (question_id, created_at);

-- Which answers the canonical text was synthesised from, so credit is explicit
-- rather than implied by whoever typed it last.
create table canonical_answer_sources (
  question_id integer not null references questions (id) on delete cascade,
  answer_id   integer not null references answers (id) on delete cascade,
  primary key (question_id, answer_id)
);

-- A challenge is a first-class object: disagreeing with the canonical answer
-- is part of maintaining it, not an exception to be handled out of band.
create table canonical_challenges (
  id          integer primary key autoincrement,
  question_id integer not null references questions (id) on delete cascade,
  actor_id    text not null references actors (id),
  reason      text not null,
  state       text not null default 'open' check (state in ('open', 'accepted', 'rejected')),
  resolved_by text references actors (id),
  resolved_at text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index canonical_challenges_open_idx on canonical_challenges (question_id, state);
