DO $$
DECLARE
  v_test_id uuid := gen_random_uuid();
  v_deleted integer;
  v_remaining integer;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_test_id, 'authenticated', 'authenticated',
    'preupdate-rotation-' || replace(v_test_id::text, '-', '') || '@example.invalid',
    '', now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pre-update rotation test"}'::jsonb,
    false, '', ''
  );

  PERFORM set_config('request.jwt.claim.sub', v_test_id::text, true);

  INSERT INTO public.user_backups (user_id, name, created_at, topic_ids, snapshot)
  VALUES
    (v_test_id, 'rotation-test-1', now() - interval '2 minutes', ARRAY['system:pre-update'], '{}'::jsonb),
    (v_test_id, 'rotation-test-2', now() - interval '1 minute', ARRAY['system:pre-update'], '{}'::jsonb),
    (v_test_id, 'rotation-test-3', now(), ARRAY['system:pre-update'], '{}'::jsonb);

  SELECT public.prune_preupdate_backups(2) INTO v_deleted;
  SELECT count(*)::integer INTO v_remaining
  FROM public.user_backups
  WHERE user_id = v_test_id
    AND topic_ids @> ARRAY['system:pre-update']::text[];

  IF v_deleted <> 1 OR v_remaining <> 2 THEN
    RAISE EXCEPTION 'Expected 1 deleted and 2 remaining, got % deleted and % remaining',
      v_deleted, v_remaining;
  END IF;

  DELETE FROM auth.users WHERE id = v_test_id;
END;
$$;
