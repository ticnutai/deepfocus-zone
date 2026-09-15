-- Real cloud RPC tests. Profile changes are transaction-local and always rolled back.
DO $$ DECLARE original_claims text:=current_setting('request.jwt.claims',true); source text; contributor uuid; expected bigint; actual bigint; payload jsonb; definition text;
BEGIN
  payload:='{"source_tags":["yeshiva"],"source_user_ids":["11111111-1111-1111-1111-111111111111"],"include_site_library":false,"approved_only":true}'::jsonb;
  IF NOT public.matches_shared_question_access('["source:yeshiva"]','22222222-2222-2222-2222-222222222222',NULL,'published',payload) THEN RAISE EXCEPTION 'Independent source denied'; END IF;
  IF NOT public.matches_shared_question_access('["source:ai"]','11111111-1111-1111-1111-111111111111',NULL,'published',payload) THEN RAISE EXCEPTION 'Independent contributor denied'; END IF;
  IF public.matches_shared_question_access('["source:ai"]','22222222-2222-2222-2222-222222222222',NULL,'published',payload) THEN RAISE EXCEPTION 'Unrelated question allowed'; END IF;
  IF public.matches_shared_question_access('["source:yeshiva"]','11111111-1111-1111-1111-111111111111',NULL,'draft',payload) THEN RAISE EXCEPTION 'Draft allowed'; END IF;
 BEGIN
  SELECT (public.question_source_ids(tags))[1],coalesce(created_by,user_id) INTO source,contributor
  FROM public.cards WHERE deleted_at IS NULL AND moderation_status IN ('reviewed','published') LIMIT 1;
  IF source IS NULL THEN RAISE EXCEPTION 'No reviewed QA fixture available'; END IF;
  UPDATE public.role_content_access SET include_own=false,include_site_library=false,approved_only=true,source_user_ids='{}',source_tags=ARRAY[source]
  WHERE role_id IN (SELECT id FROM public.app_roles WHERE access_kind='anonymous_online');
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Anonymous isolation failed'; END IF;
  IF public.get_effective_question_source_tags() <> ARRAY[source] THEN RAISE EXCEPTION 'Independent source role selection mismatch'; END IF;
  UPDATE public.role_content_access SET source_user_ids=ARRAY[contributor]
  WHERE role_id IN (SELECT id FROM public.app_roles WHERE access_kind='anonymous_online');
  payload:=public.get_content_unreviewed_cards_page(0,10);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload) c WHERE NOT(source=ANY(public.question_source_ids(c->'tags')) OR coalesce(c->>'created_by',c->>'user_id')=contributor::text)) THEN RAISE EXCEPTION 'Union RPC mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload) c WHERE c->>'moderation_status' NOT IN ('reviewed','published')) THEN RAISE EXCEPTION 'Unapproved content leaked'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(payload))<>(SELECT count(DISTINCT c->>'id') FROM jsonb_array_elements(payload) c) THEN RAISE EXCEPTION 'Duplicate questions'; END IF;
  UPDATE public.role_content_access SET source_user_ids='{}',source_tags='{}'
  WHERE role_id IN (SELECT id FROM public.app_roles WHERE access_kind='anonymous_online');
  IF jsonb_array_length(public.get_content_unreviewed_cards_page(0,10))<>0 THEN RAISE EXCEPTION 'Empty selection should not grant shared content'; END IF;
  RAISE EXCEPTION 'QA_ROLLBACK_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'QA_ROLLBACK_SUCCESS' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claims',coalesce(original_claims,''),true);
 definition:=pg_get_functiondef('public.get_content_unreviewed_cards_page(integer,integer)'::regprocedure);
 IF position('matches_shared_question_access' IN definition)=0 OR position('hidden_by_admin_card_ids' IN definition)=0 THEN RAISE EXCEPTION 'Query safeguards missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='cards' AND policyname='cards_question_source_boundary' AND qual LIKE '%matches_shared_question_access%') THEN RAISE EXCEPTION 'RLS union missing'; END IF;
END; $$;
