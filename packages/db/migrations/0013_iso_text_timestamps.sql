-- Postgres-only fix (see migrations-pg/0013_iso_text_timestamps.sql): SQLite
-- already stores ISO-8601 through its strftime defaults. Kept so the two
-- editions share filenames.
select 1;
