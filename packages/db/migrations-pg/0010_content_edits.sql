-- Postgres edition of migrations/0010_content_edits.sql, generated with `npx libsql-pg convert-schema`
-- (text timestamps kept as text) and reviewed. Applied by src/migrate.ts when DATABASE_URL is
-- postgres://; keep the two directories in step.

alter table questions add column if not exists is_deleted bigint not null default 0;

alter table questions add column if not exists deleted_at text;

alter table answers add column if not exists is_deleted bigint not null default 0;

alter table answers add column if not exists deleted_at text;

alter table comments add column if not exists deleted_at text;

alter table questions add column if not exists edited_at text;

alter table answers add column if not exists edited_at text;

alter table comments add column if not exists edited_at text;

create index questions_visible_idx on questions (is_hidden, is_deleted, created_at, id);

create index answers_visible_idx on answers (question_id, is_hidden, is_deleted);
