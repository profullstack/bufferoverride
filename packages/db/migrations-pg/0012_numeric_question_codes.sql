-- Postgres edition of migrations/0012_numeric_question_codes.sql. The statement
-- is portable SQL, so the two editions are identical; keep them in step.

update questions
   set code = 'a' || substr(code, 2)
 where code not like '%a%' and code not like '%b%' and code not like '%c%'
   and code not like '%d%' and code not like '%e%' and code not like '%f%';
