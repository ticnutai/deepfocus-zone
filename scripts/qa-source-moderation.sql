DO $$
DECLARE admin_id uuid:=auth.uid(); deck uuid; source text:='qa-approval-'||gen_random_uuid(); tag jsonb;
 a uuid:=gen_random_uuid(); h uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid(); untrusted uuid:=gen_random_uuid(); ordinary uuid; denied boolean:=false; n bigint;
BEGIN
 IF NOT public.is_admin(admin_id) THEN RAISE EXCEPTION 'Admin required'; END IF;
 SELECT id INTO deck FROM public.decks LIMIT 1;
 SELECT id INTO ordinary FROM public.profiles WHERE NOT public.is_admin(id) LIMIT 1;
 IF deck IS NULL OR ordinary IS NULL THEN RAISE EXCEPTION 'Missing test prerequisites'; END IF;
 tag:=jsonb_build_array('source:'||source);
 BEGIN
  INSERT INTO public.cards(id,user_id,deck_id,type,question,tags,moderation_status,deleted_at) VALUES
   (a,admin_id,deck,'flashcard','QA temporary',tag,'private',NULL),
   (h,admin_id,deck,'flashcard','QA hidden',tag,'hidden',NULL),
   (d,admin_id,deck,'flashcard','QA deleted',tag,'private',now());
  n:=public.admin_approve_question_source(source);
  IF NOT EXISTS(SELECT 1 FROM public.get_admin_question_source_tags() WHERE source_id=source AND question_count=2 AND approved_count=1 AND hidden_count=1 AND pending_count=0) THEN RAISE EXCEPTION 'Incremental approval counts incorrect'; END IF;
  IF n<>1 THEN RAISE EXCEPTION 'Wrong approval count: %',n; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.cards WHERE id=a AND moderation_status='reviewed' AND user_id=admin_id AND deck_id=deck AND moderated_by=admin_id) THEN RAISE EXCEPTION 'Approval failed'; END IF;
  IF EXISTS(SELECT 1 FROM public.cards WHERE (id=h AND moderation_status<>'hidden') OR (id=d AND moderation_status<>'private')) THEN RAISE EXCEPTION 'Hidden/deleted modified'; END IF;
  IF public.admin_approve_question_source(source)<>0 THEN RAISE EXCEPTION 'Not idempotent'; END IF;
  PERFORM public.admin_set_source_auto_approval(source,true);
  INSERT INTO public.cards(id,user_id,deck_id,type,question,tags) VALUES(fresh,admin_id,deck,'flashcard','QA auto',tag);
  IF NOT EXISTS(SELECT 1 FROM public.cards WHERE id=fresh AND moderation_status='reviewed') THEN RAISE EXCEPTION 'Auto approval failed'; END IF;
  PERFORM set_config('request.jwt.claim.sub',ordinary::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ordinary,'role','authenticated')::text,true);
  BEGIN PERFORM public.admin_approve_question_source(source); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Nonadmin approval allowed'; END IF;
  denied:=false;
  BEGIN PERFORM public.admin_set_source_auto_approval(source,false); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Nonadmin settings allowed'; END IF;
  INSERT INTO public.cards(id,user_id,deck_id,type,question,tags) VALUES(untrusted,ordinary,deck,'flashcard','QA untrusted',tag);
  IF NOT EXISTS(SELECT 1 FROM public.cards WHERE id=untrusted AND moderation_status='private') THEN RAISE EXCEPTION 'Untrusted source spoof approved'; END IF;
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  PERFORM public.admin_set_source_auto_approval(source,false);
  UPDATE public.cards SET deleted_at=now() WHERE id=a;
  IF NOT EXISTS(SELECT 1 FROM public.get_admin_question_source_tags() WHERE source_id=source AND question_count=3 AND approved_count=1 AND hidden_count=1 AND pending_count=1) THEN RAISE EXCEPTION 'Soft-delete count incorrect'; END IF;
  UPDATE public.cards SET deleted_at=NULL,tags=tag||jsonb_build_array('source:'||source) WHERE id=a;
  IF NOT EXISTS(SELECT 1 FROM public.get_admin_question_source_tags() WHERE source_id=source AND question_count=4 AND approved_count=2) THEN RAISE EXCEPTION 'Restore or duplicate tags count incorrect'; END IF;
  IF EXISTS(SELECT 1 FROM public.question_source_approval_rules WHERE source_id=source AND enabled) THEN RAISE EXCEPTION 'Disable failed'; END IF;
  RAISE EXCEPTION 'Rollback QA fixtures' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.cards WHERE id IN(a,h,d,fresh,untrusted)) OR EXISTS(SELECT 1 FROM public.question_source_approval_rules WHERE source_id=source) THEN RAISE EXCEPTION 'Fixture leak'; END IF;
END $$;
