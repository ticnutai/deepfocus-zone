-- Read-only truth table for the shared RPC/RLS predicate.
DO $$ DECLARE p jsonb;
BEGIN
 p:='{"source_tags":["yeshiva"],"source_user_ids":[],"include_site_library":true,"approved_only":true,"central_source_user_id":"11111111-1111-1111-1111-111111111111"}';
 IF public.matches_shared_question_access('["source:shemesh"]','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','published',p) THEN RAISE EXCEPTION 'Library bypass'; END IF;
 IF NOT public.matches_shared_question_access('["source:yeshiva"]','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','published',p) THEN RAISE EXCEPTION 'Selected source denied'; END IF;
 IF public.matches_shared_question_access('["source:yeshiva"]',NULL,NULL,'draft',p) THEN RAISE EXCEPTION 'Draft leaked'; END IF;
 p:=jsonb_set(p,'{source_tags}','[]');
 IF public.matches_shared_question_access('["source:shemesh"]',NULL,'11111111-1111-1111-1111-111111111111','published',p) THEN RAISE EXCEPTION 'Empty selection bypass'; END IF;
 p:=jsonb_set(p,'{source_user_ids}','["22222222-2222-2222-2222-222222222222"]');
 IF NOT public.matches_shared_question_access('["source:shemesh"]','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','published',p) THEN RAISE EXCEPTION 'Explicit contributor denied'; END IF;
 p:=jsonb_set(p,'{source_tags}','null');
 IF NOT public.matches_shared_question_access('["source:shemesh"]',NULL,'11111111-1111-1111-1111-111111111111','published',p) THEN RAISE EXCEPTION 'Legacy unrestricted profile changed'; END IF;
END $$;
