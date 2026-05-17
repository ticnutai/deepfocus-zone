import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://htsuoqvafayyffyxjhhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c3VvcXZhZmF5eWZmeXhqaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzQ5OTgsImV4cCI6MjA5MzA1MDk5OH0.QI8kxYPYp9P84HoHl8qNjcGo7jVgobNsv7Fan0LIXxQ'
);

await sb.auth.signInWithPassword({ email: 'jj1212t@gmail.com', password: '543211' });
console.log('Logged in');

// Step 1: Update exec_sql to have no statement timeout
const updateFn = `
CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = 0
AS $$
DECLARE
  caller_email text;
  t_start      timestamptz;
  t_end        timestamptz;
  row_count    bigint;
  stmt_type    text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();
  IF caller_email IS NULL OR caller_email NOT IN ('jj1212t@gmail.com') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  stmt_type := upper(split_part(ltrim(regexp_replace(query, '/\\*.*?\\*/', '', 'g')), ' ', 1));
  t_start := clock_timestamp();
  EXECUTE query;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  t_end := clock_timestamp();
  RETURN json_build_object(
    'success', true,
    'rows_affected', row_count,
    'duration_ms', round(extract(epoch from (t_end - t_start)) * 1000),
    'statement_type', stmt_type
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
END;
$$;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated;
`;

const { data: d1, error: e1 } = await sb.rpc('exec_sql', { query: updateFn });
console.log('Update exec_sql:', JSON.stringify({ data: d1, error: e1 }));

// Step 2: Delete duplicate root categories (CASCADE deletes their subtrees)
const deleteSQL = `
DELETE FROM public.categories
WHERE id IN (
  '69dfc979-fd02-4f8c-8dbc-fb4bb4301ebd',
  'a358e355-52f5-413b-b1ac-25fafddb5627',
  'e3f0a78b-6d73-47c3-99c5-0c6e746d8d69',
  '5bf71860-8f1b-417d-aad0-fa7097003052',
  '235c4086-6fec-41b4-9bc2-83ea34c27788',
  'e2323337-d567-4e01-bb3c-d7cb6393dae8',
  '1c148799-23b9-41b5-bb5a-c68535e55a5b',
  '16dd98e6-bda7-4d72-9444-e40cccbe145b',
  '5941762f-4a1b-42f2-a5b6-42e233399ac0',
  '9bb81e66-c64b-4fe0-b2d6-934f2ebace04'
)
`;

console.log('Starting delete (may take a while)...');
const { data: d2, error: e2 } = await sb.rpc('exec_sql', { query: deleteSQL });
console.log('Delete result:', JSON.stringify({ data: d2, error: e2 }));

// Step 3: Count remaining categories
const { count } = await sb.from('categories').select('*', { count: 'exact', head: true });
console.log('Remaining categories:', count);
