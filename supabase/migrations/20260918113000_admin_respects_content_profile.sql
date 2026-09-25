-- Administrators retain every administrative permission, while the learning
-- library follows the same explicit content profile as other registered users.
-- No users, roles, questions, categories, or profile selections are changed.
DO $$
DECLARE
  original text;
  changed text;
BEGIN
  original := pg_get_functiondef('public.get_effective_content_access()'::regprocedure);
  changed := regexp_replace(
    original,
    'if\s+v_uid\s+is\s+not\s+null\s+and\s+public\.is_admin\(v_uid\)\s+then[\s\S]*?end\s+if;',
    '',
    'i'
  );
  IF changed = original THEN
    RAISE EXCEPTION 'Administrator content bypass changed; review before applying';
  END IF;

  changed := regexp_replace(
    changed,
    '''is_admin''\s*,\s*false',
    '''is_admin'', coalesce(public.is_admin(v_uid), false)',
    'i'
  );
  IF changed NOT LIKE '%coalesce(public.is_admin(v_uid), false)%' THEN
    RAISE EXCEPTION 'Administrator marker changed; review before applying';
  END IF;

  EXECUTE changed;
END $$;

DO $$
DECLARE policy jsonb;
BEGIN
  policy := public.get_effective_content_access();
  IF NOT coalesce((policy->>'is_admin')::boolean, false) THEN
    RAISE EXCEPTION 'Administrator permission marker was lost; rolling back';
  END IF;
  IF policy->'source_tags' IS NULL THEN
    RAISE EXCEPTION 'Registered content profile has no explicit source selection; rolling back';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
