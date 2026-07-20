DO $$
DECLARE
  v_test_id uuid := gen_random_uuid();
  v_test_email text := 'approval-smoke-' || replace(v_test_id::text, '-', '') || '@example.invalid';
  v_status text;
  v_confirmed_at timestamptz;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_test_id, 'authenticated', 'authenticated', v_test_email,
    extensions.crypt('temporary-smoke-password', extensions.gen_salt('bf')),
    now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Approval smoke test"}'::jsonb,
    false, '', ''
  );

  SELECT status INTO v_status FROM public.profiles WHERE id = v_test_id;
  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Expected pending profile, got %', v_status;
  END IF;

  PERFORM public.admin_set_profile_status(v_test_id, 'approved');

  SELECT p.status, u.email_confirmed_at
  INTO v_status, v_confirmed_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = v_test_id;

  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Expected approved profile, got %', v_status;
  END IF;
  IF v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Expected administrator approval to confirm email';
  END IF;

  DELETE FROM auth.users WHERE id = v_test_id;
END;
$$;
