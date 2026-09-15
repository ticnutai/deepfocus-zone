-- Additive only: provenance narrows existing content grants, never grants access.
ALTER TABLE public.role_content_access ADD COLUMN IF NOT EXISTS source_tags text[];

CREATE OR REPLACE FUNCTION public.question_source_ids(tags jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN count(*)=0 THEN ARRAY['unattributed'] ELSE array_agg(DISTINCT substring(t from 8)) END
 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(tags)='array' THEN tags ELSE '[]'::jsonb END) t WHERE t LIKE 'source:%' AND t NOT LIKE 'source:client:%';
$$;

CREATE OR REPLACE FUNCTION public.get_effective_question_source_tags() RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result text[]; unrestricted boolean;
BEGIN
 IF public.is_admin(auth.uid()) THEN RETURN NULL; END IF;
 WITH roles AS (
  SELECT r.id FROM public.app_roles r WHERE
   (auth.uid() IS NULL AND r.access_kind='anonymous_online') OR
   (auth.uid() IS NOT NULL AND r.access_kind=CASE WHEN coalesce((SELECT is_anonymous FROM auth.users WHERE id=auth.uid()),false) THEN 'anonymous_online' ELSE 'registered' END) OR
   (auth.uid() IS NOT NULL AND r.access_kind IS NULL AND EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=auth.uid() AND u.role_id=r.id))
 ), rules AS (SELECT a.source_tags FROM public.role_content_access a JOIN roles r ON r.id=a.role_id)
 SELECT coalesce(bool_or(source_tags IS NULL),true),coalesce(array_agg(DISTINCT t) FILTER(WHERE t IS NOT NULL),'{}')
 INTO unrestricted,result FROM rules LEFT JOIN LATERAL unnest(source_tags) t ON true;
 IF unrestricted THEN RETURN NULL; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_effective_question_source_tags() FROM public;
GRANT EXECUTE ON FUNCTION public.get_effective_question_source_tags() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_question_source_tags() RETURNS TABLE(source_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required'; END IF;
 RETURN QUERY SELECT DISTINCT unnest(public.question_source_ids(c.tags)) FROM public.cards c WHERE c.deleted_at IS NULL;
END; $$;
REVOKE ALL ON FUNCTION public.get_admin_question_source_tags() FROM public;
GRANT EXECUTE ON FUNCTION public.get_admin_question_source_tags() TO authenticated;

-- Extend the canonical writer in its existing transaction, with drift guards.
DO $$ DECLARE original text; changed text; name text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO original FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_save_access_profile';
 changed:=replace(original,'content:=coalesce(', E'IF p_layout->\'contentAccess\'->\'sourceTags\' IS NOT NULL AND p_layout->\'contentAccess\'->\'sourceTags\' <> \'null\'::jsonb AND jsonb_typeof(p_layout->\'contentAccess\'->\'sourceTags\') <> \'array\' THEN RAISE EXCEPTION \'Invalid source tags\'; END IF;\n  content:=coalesce(');
 IF changed=original THEN RAISE EXCEPTION 'Profile writer changed; review required'; END IF;
 -- Role rows are inserted by the existing writer before its final END.
 changed:=regexp_replace(changed, 'end;\s*\$function\$', E'update public.role_content_access set source_tags=case when jsonb_typeof(content->\'sourceTags\')=\'array\' then ARRAY(select distinct jsonb_array_elements_text(content->\'sourceTags\')) else null end where role_id=any(roles);\nend;\n$function$', 'i');
 IF position('set source_tags=' in changed)=0 THEN RAISE EXCEPTION 'Writer end not found'; END IF;
 EXECUTE changed;
 FOREACH name IN ARRAY ARRAY['get_content_overlay_snapshot()','get_content_unreviewed_cards_page(integer,integer)','get_content_card_categories()'] LOOP
  original:=pg_get_functiondef(('public.'||name)::regprocedure);
  changed:=replace(original,'c.deleted_at is null','c.deleted_at is null AND ((SELECT public.get_effective_question_source_tags()) IS NULL OR public.question_source_ids(c.tags) && (SELECT public.get_effective_question_source_tags()))');
  IF changed=original THEN RAISE EXCEPTION 'Content query changed: %',name; END IF;
  EXECUTE changed;
 END LOOP;
 original:=pg_get_functiondef('public.get_effective_content_access()'::regprocedure);
 changed:=replace(original,'''is_admin'',false','''source_tags'',to_jsonb(public.get_effective_question_source_tags()),''is_admin'',false');
 IF changed=original THEN RAISE EXCEPTION 'Effective access changed'; END IF;
 EXECUTE changed;
END; $$;
CREATE POLICY cards_question_source_boundary ON public.cards AS RESTRICTIVE FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) OR (SELECT public.get_effective_question_source_tags()) IS NULL OR public.question_source_ids(tags) && (SELECT public.get_effective_question_source_tags()));
NOTIFY pgrst,'reload schema';
