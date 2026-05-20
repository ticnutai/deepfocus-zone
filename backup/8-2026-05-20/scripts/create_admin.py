import requests

PAT = "sbp_v0_7d035602aaa48c59cc245948fd58d86872199690"
REF = "htsuoqvafayyffyxjhhh"

sql = """
DO $$
DECLARE
  v_user_id uuid;
  v_admin_role_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'ticnutai@gmail.com';
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated', 'ticnutai@gmail.com',
      crypt('543211', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"ticnutai"}',
      false, '', ''
    );
    INSERT INTO public.profiles (id, display_name)
    VALUES (v_user_id, 'ticnutai') ON CONFLICT (id) DO NOTHING;
  ELSE
    -- Update password in case it was wrong
    UPDATE auth.users SET encrypted_password = crypt('543211', gen_salt('bf'))
    WHERE id = v_user_id;
  END IF;
  SELECT id INTO v_admin_role_id FROM public.app_roles WHERE name = 'admin';
  IF v_admin_role_id IS NULL THEN
    INSERT INTO public.app_roles (name, description, is_system)
    VALUES ('admin', 'Administrator', true) RETURNING id INTO v_admin_role_id;
  END IF;
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_user_id, v_admin_role_id) ON CONFLICT (user_id, role_id) DO NOTHING;
END $$;
"""

r = requests.post(
    f"https://api.supabase.com/v1/projects/{REF}/database/query",
    headers={"Authorization": f"Bearer {PAT}", "Content-Type": "application/json"},
    json={"query": sql},
    timeout=30
)
print(f"Status: {r.status_code}")
print(r.text[:1000])
