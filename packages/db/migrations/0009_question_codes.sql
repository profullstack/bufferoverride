-- Public shortcodes for questions.
--
-- The row id stays an integer: it is the FTS5 rowid every search joins on, and
-- eight migrations of foreign keys point at it. What changes is the identifier
-- the world sees. A sequential number in a URL announces how much content the
-- site has, invites enumeration of anything that was ever briefly public, and
-- reads as a database artefact rather than an address.
--
-- So every question also carries an opaque code, and that is what appears in
-- /q/<code>/<slug>, in the API, in feeds and in citations. Numeric URLs already
-- indexed keep working: the route resolves them and redirects permanently to
-- the code form, so nothing that was linked goes dark.
alter table questions add column code text;

-- Backfill. randomblob is the only entropy SQLite offers; hex of it is opaque,
-- URL-safe and case-insensitive, which is all a code has to be. New rows get
-- theirs from the application, which can retry a collision.
update questions set code = substr(lower(hex(randomblob(8))), 1, 10) where code is null;

create unique index questions_code_idx on questions (code);
