-- Postgres only. The converted schema gave every SQLite
-- `default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` a plain `default now()` on a
-- TEXT column, so rows inserted since the move store Postgres's text form
-- ('2026-10-21 13:27:08.306295+00') while the code writes and compares ISO-8601
-- ('2026-10-21T13:27:08.306Z'). Text comparison puts ' ' before 'T', so a row
-- made earlier today never counted as "within the last hour": the magic-link
-- and per-action rate limits missed every same-day row. Restore the ISO default
-- and rewrite the stored values to it so every comparison is like with like.

alter table actors alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table agent_owners alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table agent_profiles alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table answers alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table answers alter column updated_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table api_keys alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table audit_events alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table canonical_answer_revisions alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table canonical_answers alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table canonical_answers alter column updated_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table canonical_challenges alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table cli_authorizations alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table coinpay_wallets alter column synced_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table comments alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table duplicate_links alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table flags alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table magic_links alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table moderation_actions alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table notifications alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table oauth_identities alter column linked_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table passkeys alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table push_subscriptions alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table questions alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table questions alter column updated_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table revisions alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table sessions alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table verifications alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table votes alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table watches alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
alter table webauthn_challenges alter column created_at set default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
update actors set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update actors set reputation_computed_at = to_char(reputation_computed_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where reputation_computed_at ~ '^\d{4}-\d\d-\d\d \d';
update agent_owners set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update agent_profiles set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update answers set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update answers set deleted_at = to_char(deleted_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where deleted_at ~ '^\d{4}-\d\d-\d\d \d';
update answers set edited_at = to_char(edited_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where edited_at ~ '^\d{4}-\d\d-\d\d \d';
update answers set updated_at = to_char(updated_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where updated_at ~ '^\d{4}-\d\d-\d\d \d';
update api_keys set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update api_keys set last_used_at = to_char(last_used_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where last_used_at ~ '^\d{4}-\d\d-\d\d \d';
update api_keys set revoked_at = to_char(revoked_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where revoked_at ~ '^\d{4}-\d\d-\d\d \d';
update audit_events set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update canonical_answer_revisions set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update canonical_answers set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update canonical_answers set updated_at = to_char(updated_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where updated_at ~ '^\d{4}-\d\d-\d\d \d';
update canonical_challenges set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update canonical_challenges set resolved_at = to_char(resolved_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where resolved_at ~ '^\d{4}-\d\d-\d\d \d';
update cli_authorizations set approved_at = to_char(approved_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where approved_at ~ '^\d{4}-\d\d-\d\d \d';
update cli_authorizations set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update cli_authorizations set denied_at = to_char(denied_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where denied_at ~ '^\d{4}-\d\d-\d\d \d';
update cli_authorizations set expires_at = to_char(expires_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where expires_at ~ '^\d{4}-\d\d-\d\d \d';
update coinpay_wallets set synced_at = to_char(synced_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where synced_at ~ '^\d{4}-\d\d-\d\d \d';
update comments set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update comments set deleted_at = to_char(deleted_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where deleted_at ~ '^\d{4}-\d\d-\d\d \d';
update comments set edited_at = to_char(edited_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where edited_at ~ '^\d{4}-\d\d-\d\d \d';
update duplicate_links set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update flags set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update flags set resolved_at = to_char(resolved_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where resolved_at ~ '^\d{4}-\d\d-\d\d \d';
update magic_links set consumed_at = to_char(consumed_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where consumed_at ~ '^\d{4}-\d\d-\d\d \d';
update magic_links set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update magic_links set expires_at = to_char(expires_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where expires_at ~ '^\d{4}-\d\d-\d\d \d';
update moderation_actions set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update notifications set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update notifications set emailed_at = to_char(emailed_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where emailed_at ~ '^\d{4}-\d\d-\d\d \d';
update notifications set read_at = to_char(read_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where read_at ~ '^\d{4}-\d\d-\d\d \d';
update oauth_identities set last_login_at = to_char(last_login_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where last_login_at ~ '^\d{4}-\d\d-\d\d \d';
update oauth_identities set linked_at = to_char(linked_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where linked_at ~ '^\d{4}-\d\d-\d\d \d';
update passkeys set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update passkeys set last_used_at = to_char(last_used_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where last_used_at ~ '^\d{4}-\d\d-\d\d \d';
update push_subscriptions set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update questions set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update questions set deleted_at = to_char(deleted_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where deleted_at ~ '^\d{4}-\d\d-\d\d \d';
update questions set edited_at = to_char(edited_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where edited_at ~ '^\d{4}-\d\d-\d\d \d';
update questions set updated_at = to_char(updated_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where updated_at ~ '^\d{4}-\d\d-\d\d \d';
update revisions set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update sessions set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update sessions set expires_at = to_char(expires_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where expires_at ~ '^\d{4}-\d\d-\d\d \d';
update sessions set last_seen_at = to_char(last_seen_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where last_seen_at ~ '^\d{4}-\d\d-\d\d \d';
update verifications set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update votes set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update watches set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update webauthn_challenges set created_at = to_char(created_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where created_at ~ '^\d{4}-\d\d-\d\d \d';
update webauthn_challenges set expires_at = to_char(expires_at::timestamptz at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where expires_at ~ '^\d{4}-\d\d-\d\d \d';
