DO $$ DECLARE source text:='qa-batch-'||gen_random_uuid(); deck uuid; admin_id uuid:=auth.uid();
BEGIN
 IF NOT public.is_admin(admin_id) THEN RAISE EXCEPTION 'Admin required'; END IF;
 SELECT id INTO deck FROM public.decks LIMIT 1;
 BEGIN
  INSERT INTO public.cards(user_id,deck_id,type,question,tags,moderation_status)
  SELECT admin_id,deck,'flashcard',source||' question '||n,jsonb_build_array('source:'||source),'private' FROM generate_series(1,205) n;
  IF public.admin_approve_question_source(source)<>100 THEN RAISE EXCEPTION 'First batch limit failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.question_source_counts WHERE source_id=source AND approved_count=100 AND pending_count=105) THEN RAISE EXCEPTION 'First checkpoint incorrect'; END IF;
  IF public.admin_approve_question_source(source)<>100 THEN RAISE EXCEPTION 'Second batch failed'; END IF;
  IF public.admin_approve_question_source(source)<>5 THEN RAISE EXCEPTION 'Final batch failed'; END IF;
  IF public.admin_approve_question_source(source)<>0 THEN RAISE EXCEPTION 'Already approved rows repeated'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.question_source_counts WHERE source_id=source AND approved_count=205 AND pending_count=0) THEN RAISE EXCEPTION 'Final counts incorrect'; END IF;
  RAISE EXCEPTION 'Rollback fixtures' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.question_source_counts WHERE source_id=source) THEN RAISE EXCEPTION 'Fixture leak'; END IF;
END $$;
