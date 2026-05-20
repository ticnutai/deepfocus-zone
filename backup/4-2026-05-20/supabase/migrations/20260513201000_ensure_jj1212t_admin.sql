-- Ensure jj1212t@gmail.com exists, has password 543211, and is assigned admin role
DO $$
DECLARE
  v_user_id uuid;
  v_admin_role_id uuid;
BEGIN
  -- Ensure admin role exists
  SELECT id INTO v_admin_role_id
  FROM public.app_roles
  WHERE name = 'admin'
  LIMIT 1;

  IF v_admin_role_id IS NULL THEN
    INSERT INTO public.app_roles (name, description, is_system)
    VALUES ('admin', 'Administrator', true)
    RETURNING id INTO v_admin_role_id;
  END IF;

  -- Ensure user exists
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'jj1212t@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      confirmation_token,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      'jj1212t@gmail.com',
      crypt('543211', gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"jj1212t"}',
      false,
      '',
      ''
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('543211', gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  -- Ensure user has profile row
  INSERT INTO public.profiles (id, display_name)
  VALUES (v_user_id, 'jj1212t')
  ON CONFLICT (id) DO NOTHING;

  -- Ensure admin role is assigned
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_user_id, v_admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END $$;
