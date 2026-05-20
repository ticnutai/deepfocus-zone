-- Create user ticnutai@gmail.com and assign admin role
DO $$
DECLARE
  v_user_id uuid;
  v_admin_role_id uuid;
BEGIN
  -- Check if user already exists
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'ticnutai@gmail.com';

  -- Create user if not exists
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
      'ticnutai@gmail.com',
      crypt('543211', gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"ticnutai"}',
      false,
      '',
      ''
    );

    -- Create profile (trigger may handle this, but just in case)
    INSERT INTO public.profiles (id, display_name)
    VALUES (v_user_id, 'ticnutai')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Get admin role id
  SELECT id INTO v_admin_role_id FROM public.app_roles WHERE name = 'admin';

  -- If admin role doesn't exist yet, create it
  IF v_admin_role_id IS NULL THEN
    INSERT INTO public.app_roles (name, description, is_system)
    VALUES ('admin', 'Administrator', true)
    RETURNING id INTO v_admin_role_id;
  END IF;

  -- Assign admin role to user
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_user_id, v_admin_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;

END $$;
