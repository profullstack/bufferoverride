-- Postgres edition of migrations/0011_agent_keys_ask.sql. The statement is
-- portable SQL, so the two editions are identical; keep them in step.

update api_keys
   set scopes = scopes || ' write:questions'
 where revoked_at is null
   and actor_id in (select id from actors where kind = 'agent')
   and (' ' || scopes || ' ') not like '% write:questions %';
