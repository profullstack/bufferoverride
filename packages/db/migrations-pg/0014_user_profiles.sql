-- Postgres edition of migrations/0014_user_profiles.sql (DDL from
-- `profile schema --key user_id --key-type text`). Keep the two in step.
--
-- The signup profile from @profullstack/profile. PRIVATE: its own table, never
-- on actors (the public profile). magic_links.profile carries the validated
-- /signup fields (JSON) until the link is followed and the actor exists.

create table if not exists "user_profiles" (
  "user_id" text primary key,
  "email" text,
  "first_name" text,
  "last_name" text,
  "company_domain" text,
  "job_title" text,
  "linkedin_url" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create index if not exists "user_profiles_email" on "user_profiles" (lower("email"));

create index if not exists "user_profiles_company_domain" on "user_profiles" ("company_domain");

alter table magic_links add column if not exists profile text;
