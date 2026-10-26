-- The signup profile from @profullstack/profile: email, name, company, title,
-- LinkedIn. PRIVATE: it lives in its own table, never on actors (whose
-- username/display_name are the public profile). Keyed by actors.id.
--
-- magic_links.profile carries the validated /signup fields (JSON) from the
-- request to the click, because the actor is only created when the link is
-- followed. No backfill: actors.display_name defaults to the username, a handle
-- and not a person's name.

create table if not exists "user_profiles" (
  "user_id" text primary key,
  "email" text,
  "first_name" text,
  "last_name" text,
  "company_domain" text,
  "job_title" text,
  "linkedin_url" text,
  "created_at" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create index if not exists "user_profiles_email" on "user_profiles" (lower("email"));

create index if not exists "user_profiles_company_domain" on "user_profiles" ("company_domain");

alter table magic_links add column profile text;
