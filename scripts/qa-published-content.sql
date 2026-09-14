-- Run through the project's admin runner. All fixture writes roll back.
DO $$
DECLARE
  admin_id uuid := auth.uid();
  test_user uuid;
  test_card uuid := gen_random_uuid();
  blocked boolean;
BEGIN
  IF NOT public.is_admin(admin_id) THEN RAISE EXCEPTION 'Admin test runner required'; END IF;
  SELECT id INTO test_user FROM auth.users WHERE email = 'ticnutai6@gmail.com';
  IF test_user IS NULL OR public.is_admin(test_user) THEN RAISE EXCEPTION 'Non-admin test account required'; END IF;
  BEGIN
    INSERT INTO public.cards(id,user_id,type,question) VALUES(test_card,test_user,'flashcard','QA rollback fixture');
    PERFORM set_config('request.jwt.claim.sub',test_user::text,true);
    PERFORM set_config('request.jwt.claims',json_build_object('sub',test_user,'role','authenticated')::text,true);
    UPDATE public.cards SET question='QA private edit' WHERE id=test_card;
    blocked := false;
    BEGIN
      UPDATE public.cards SET moderation_status='published' WHERE id=test_card;
    EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Self-publication was not blocked'; END IF;
    PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
    PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
    UPDATE public.cards SET moderation_status='published' WHERE id=test_card;
    PERFORM set_config('request.jwt.claim.sub',test_user::text,true);
    PERFORM set_config('request.jwt.claims',json_build_object('sub',test_user,'role','authenticated')::text,true);
    UPDATE public.cards SET stats='{"totalReviews":1,"correct":1,"incorrect":0}' WHERE id=test_card;
    blocked := false;
    BEGIN
      UPDATE public.cards SET question='forbidden' WHERE id=test_card;
    EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Published edit was not blocked'; END IF;
    blocked := false;
    BEGIN
      UPDATE public.cards SET deleted_at=now() WHERE id=test_card;
    EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Soft delete was not blocked'; END IF;
    blocked := false;
    BEGIN
      DELETE FROM public.cards WHERE id=test_card;
    EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
    IF NOT blocked THEN RAISE EXCEPTION 'Hard delete was not blocked'; END IF;
    PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
    PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
    UPDATE public.cards SET question='admin edit' WHERE id=test_card;
    DELETE FROM public.cards WHERE id=test_card;
    RAISE EXCEPTION 'Rollback fixtures' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.cards WHERE id=test_card) THEN RAISE EXCEPTION 'Fixture leaked'; END IF;
END;
$$;
