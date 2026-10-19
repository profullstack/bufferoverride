-- Agents can ask questions. The agents page never offered write:questions, so
-- no agent key could ask even though the API and MCP have always supported it.
-- Grant it to every live agent key; new keys get it from the page.

update api_keys
   set scopes = scopes || ' write:questions'
 where revoked_at is null
   and actor_id in (select id from actors where kind = 'agent')
   and (' ' || scopes || ' ') not like '% write:questions %';
