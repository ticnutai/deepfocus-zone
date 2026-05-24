
-- 1) username column on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

-- Case-insensitive uniqueness for non-null usernames
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_uidx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- 2) Lookup helper: username -> email (used by login form)
CREATE OR REPLACE FUNCTION public.email_for_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.profiles
  WHERE lower(username) = lower(p_username)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.email_for_username(text) TO anon, authenticated;

-- 3) Suggest available usernames (admin-only)
CREATE OR REPLACE FUNCTION public.suggest_usernames(p_base text, p_count integer DEFAULT 5)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_base text;
  v_candidate text;
  v_result text[] := ARRAY[]::text[];
  v_i integer := 0;
  v_n integer := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.app_roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_caller AND r.name = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can suggest usernames';
  END IF;

  v_base := regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_\.]', '', 'g');
  IF length(v_base) = 0 THEN v_base := 'user'; END IF;

  -- Bare base if free
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_base) THEN
    v_result := array_append(v_result, v_base);
    v_n := v_n + 1;
  END IF;

  WHILE v_n < p_count AND v_i < 500 LOOP
    v_i := v_i + 1;
    v_candidate := v_base || v_i::text;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_candidate) THEN
      v_result := array_append(v_result, v_candidate);
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_usernames(text, integer) TO authenticated;

-- 4) Extend admin_create_user to support username-only creation
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_display_name text DEFAULT NULL,
  p_role_name text DEFAULT 'user',
  p_status text DEFAULT 'approved',
  p_username text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_user_id uuid;
  v_role_id uuid;
  v_username text;
  v_email text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.app_roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_caller AND r.name = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Only admins can create users'; END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  -- Normalize username
  IF p_username IS NOT NULL AND length(trim(p_username)) > 0 THEN
    v_username := regexp_replace(lower(trim(p_username)), '[^a-z0-9_\.]', '', 'g');
    IF length(v_username) < 3 THEN
      RAISE EXCEPTION 'Username must be at least 3 characters (letters/digits/_/.)';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_username) THEN
      RAISE EXCEPTION 'Username % is already taken', v_username;
    END IF;
  END IF;

  -- Resolve email: explicit, or synthesize from username
  IF p_email IS NOT NULL AND length(trim(p_email)) > 0 THEN
    v_email := lower(trim(p_email));
  ELSIF v_username IS NOT NULL THEN
    v_email := v_username || '@users.local';
  ELSE
    RAISE EXCEPTION 'Either email or username is required';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'User with email % already exists', v_email;
  END IF;

  v_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'display_name', COALESCE(p_display_name, v_username, split_part(v_email,'@',1)),
      'username', v_username
    ),
    false, '', ''
  );

  INSERT INTO public.profiles (id, display_name, email, status, username)
  VALUES (
    v_user_id,
    COALESCE(p_display_name, v_username, split_part(v_email,'@',1)),
    v_email,
    COALESCE(p_status, 'approved'),
    v_username
  )
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        status = EXCLUDED.status,
        username = EXCLUDED.username;

  SELECT id INTO v_role_id FROM public.app_roles WHERE name = COALESCE(p_role_name, 'user');
  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM public.app_roles WHERE name = 'user';
  END IF;
  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role_id, assigned_by)
    VALUES (v_user_id, v_role_id, v_caller)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_user_id;
END;
$$;
