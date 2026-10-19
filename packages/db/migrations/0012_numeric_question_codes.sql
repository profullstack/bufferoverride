-- A code made only of decimal digits parses as a legacy numeric id, so the
-- question it names was unreachable on the web, over REST and for its own
-- author's delete. newCode() no longer issues them; give the existing ones a
-- letter. Their old URLs never resolved, so nothing that worked breaks.

update questions
   set code = 'a' || substr(code, 2)
 where code not like '%a%' and code not like '%b%' and code not like '%c%'
   and code not like '%d%' and code not like '%e%' and code not like '%f%';
