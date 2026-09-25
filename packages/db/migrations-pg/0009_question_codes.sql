-- Postgres edition of migrations/0009_question_codes.sql, generated with `npx libsql-pg convert-schema`
-- (text timestamps kept as text) and reviewed. Applied by src/migrate.ts when DATABASE_URL is
-- postgres://; keep the two directories in step.

alter table questions add column if not exists code text;

update questions set code = substr(encode(gen_random_bytes(8), 'hex'), 1, 10) where code is null;

create unique index questions_code_idx on questions (code);
