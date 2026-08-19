-- Author edits and author deletions.
--
-- Deletion is a state, never a DELETE. The PRD requires that content deletion
-- preserve its audit metadata and that revisions stay append-only, so a removed
-- question keeps its row, its revisions, its votes and its audit trail; only
-- its visibility changes. That also means a deleted item can be told apart from
-- one that never existed, which matters when reconciling a stale index.
alter table questions add column is_deleted integer not null default 0;
alter table questions add column deleted_at text;
alter table answers   add column is_deleted integer not null default 0;
alter table answers   add column deleted_at text;
alter table comments  add column deleted_at text;

-- `updated_at` already moves for reasons that are not edits — a new answer or
-- an acceptance bumps the question. `edited_at` is only ever the author
-- rewriting the body, which is the one a reader needs to see.
alter table questions add column edited_at text;
alter table answers   add column edited_at text;
alter table comments  add column edited_at text;

-- Every public list filters on both visibility flags and orders by
-- (created_at, id); the covering index keeps that a range scan.
create index questions_visible_idx on questions (is_hidden, is_deleted, created_at, id);
create index answers_visible_idx on answers (question_id, is_hidden, is_deleted);
