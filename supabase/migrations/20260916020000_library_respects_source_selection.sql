-- One selection boundary for bootstrap, pagination and restrictive card RLS.
-- No profile or content records are changed.
DO $$ DECLARE original text; changed text; name text;
BEGIN
 original:=pg_get_functiondef('public.get_effective_content_access()'::regprocedure);
 changed:=replace(original,'v_sources||array[v_central]','v_sources');
 IF changed=original THEN RAISE EXCEPTION 'Implicit library contributor changed; review required'; END IF;
 EXECUTE changed;
 FOREACH name IN ARRAY ARRAY['get_content_overlay_snapshot()','get_content_card_categories()','get_content_unreviewed_cards_page(integer,integer)'] LOOP
  original:=pg_get_functiondef(('public.'||name)::regprocedure);
  changed:=replace(original,'coalesce(jsonb_array_length(p->''source_tags''),0)',
   '(CASE WHEN jsonb_typeof(p->''source_tags'')=''array'' THEN jsonb_array_length(p->''source_tags'') ELSE 0 END)');
  IF changed=original THEN RAISE EXCEPTION 'Source guard drift: %',name; END IF;
  EXECUTE changed;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.get_effective_question_source_tags() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH roles AS (SELECT public.effective_access_role_ids(auth.uid()) AS id)
 SELECT CASE WHEN coalesce(bool_or(a.include_site_library AND a.source_tags IS NULL),false)
 THEN NULL ELSE coalesce(array_agg(DISTINCT t) FILTER(WHERE t IS NOT NULL),'{}'::text[]) END
 FROM public.role_content_access a JOIN roles r ON r.id=a.role_id
 LEFT JOIN LATERAL unnest(a.source_tags) t ON true;
$$;

CREATE OR REPLACE FUNCTION public.matches_shared_question_access(tags jsonb, creator uuid, owner_id uuid, status text, policy jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(
  (owner_id::text=policy->>'central_source_user_id'
   AND coalesce((policy->>'include_site_library')::boolean,false)
   AND coalesce(jsonb_typeof(policy->'source_tags'),'null')='null')
  OR (
   (coalesce(policy->'source_user_ids','[]'::jsonb) ? creator::text
    OR public.question_source_ids(tags) && ARRAY(SELECT jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(policy->'source_tags')='array' THEN policy->'source_tags' ELSE '[]'::jsonb END)))
   AND (NOT coalesce((policy->>'approved_only')::boolean,true) OR status IN ('reviewed','published'))
  ),false);
$$;
NOTIFY pgrst,'reload schema';
