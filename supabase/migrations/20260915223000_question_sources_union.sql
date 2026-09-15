-- Replace the provenance intersection with independent source/contributor grants.
-- No content or account records are removed. Existing moderation/visibility stays.
CREATE OR REPLACE FUNCTION public.get_effective_question_source_tags() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH roles AS (
  SELECT r.id FROM public.app_roles r WHERE
   (auth.uid() IS NULL AND r.access_kind='anonymous_online') OR
   (auth.uid() IS NOT NULL AND r.access_kind=CASE WHEN coalesce((SELECT is_anonymous FROM auth.users WHERE id=auth.uid()),false) THEN 'anonymous_online' ELSE 'registered' END) OR
   (auth.uid() IS NOT NULL AND r.access_kind IS NULL AND EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=auth.uid() AND u.role_id=r.id))
 ) SELECT coalesce(array_agg(DISTINCT t) FILTER(WHERE t IS NOT NULL),'{}'::text[])
 FROM public.role_content_access a JOIN roles r ON r.id=a.role_id
 LEFT JOIN LATERAL unnest(a.source_tags) t ON true;
$$;

CREATE FUNCTION public.matches_shared_question_access(tags jsonb, creator uuid, owner_id uuid, status text, policy jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(
  (owner_id::text=policy->>'central_source_user_id' AND coalesce((policy->>'include_site_library')::boolean,false))
  OR (
   (coalesce(policy->'source_user_ids','[]'::jsonb) ? creator::text
    OR public.question_source_ids(tags) && ARRAY(SELECT jsonb_array_elements_text(coalesce(policy->'source_tags','[]'::jsonb))))
   AND (NOT coalesce((policy->>'approved_only')::boolean,true) OR status IN ('reviewed','published'))
  ),false);
$$;

DO $$ DECLARE name text; original text; changed text; old_predicate text;
BEGIN
 old_predicate := '((c.user_id=central_uid and coalesce((p->>''include_site_library'')::boolean,false))\s*or \(coalesce\(c.created_by,c.user_id\)=any\(uids\) and \(not approved or c.moderation_status in \(''reviewed'',''published''\)\)\)\)';
 FOREACH name IN ARRAY ARRAY['get_content_overlay_snapshot()','get_content_unreviewed_cards_page(integer,integer)','get_content_card_categories()'] LOOP
  original:=pg_get_functiondef(('public.'||name)::regprocedure);
  changed:=replace(original,' AND ((SELECT public.get_effective_question_source_tags()) IS NULL OR public.question_source_ids(c.tags) && (SELECT public.get_effective_question_source_tags()))','');
  IF changed=original THEN RAISE EXCEPTION 'Old source intersection missing: %',name; END IF;
  -- Literal replace with whitespace-normalized regex only for the existing inclusion branch.
  changed:=regexp_replace(changed,
   '\(\(c.user_id=central_uid and coalesce\(\(p->>''include_site_library''\)::boolean,false\)\)\s*or \(coalesce\(c.created_by,c.user_id\)=any\(uids\) and \(not approved or c.moderation_status in \(''reviewed'',''published''\)\)\)\)',
   'public.matches_shared_question_access(c.tags,coalesce(c.created_by,c.user_id),c.user_id,c.moderation_status::text,p)','g');
  IF position('public.matches_shared_question_access' in changed)=0 OR position('coalesce(c.created_by,c.user_id)=any(uids)' in changed)>0 THEN RAISE EXCEPTION 'Inclusion predicate drift: %',name; END IF;
  EXECUTE changed;
 END LOOP;
END; $$;

-- Retain the existing restrictive boundary, now using the SAME union as the RPCs.
ALTER POLICY cards_question_source_boundary ON public.cards USING (
 user_id=(SELECT auth.uid()) OR (SELECT public.is_admin(auth.uid())) OR
 public.matches_shared_question_access(tags,coalesce(created_by,user_id),user_id,moderation_status::text,(SELECT public.get_effective_content_access()))
);
NOTIFY pgrst,'reload schema';
