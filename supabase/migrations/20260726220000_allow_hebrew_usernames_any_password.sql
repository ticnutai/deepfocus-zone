-- Remove the arbitrary 6-char password minimum on admin-managed accounts, and
-- stop stripping non-ASCII (e.g. Hebrew) characters out of admin-created
-- usernames — the app's own offline/local account flow already allows any
-- Unicode letters and any non-empty password; these two admin RPCs enforced a
-- stricter, inconsistent rule. Security is intentionally not a concern for
-- this app, so both checks are relaxed to "must be present" only.

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
  v_ascii text;
  v_email text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.app_roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_caller AND r.name = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Only admins can create users'; END IF;

  IF p_password IS NULL OR length(p_password) < 1 THEN
    RAISE EXCEPTION 'Password is required';
  END IF;

  -- Normalize username: keep any language (Hebrew included), just trim/lowercase.
  IF p_username IS NOT NULL AND length(trim(p_username)) > 0 THEN
    v_username := lower(trim(p_username));
    IF length(v_username) < 2 THEN
      RAISE EXCEPTION 'Username must be at least 2 characters';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = v_username) THEN
      RAISE EXCEPTION 'Username % is already taken', v_username;
    END IF;
  END IF;

  -- Resolve email: explicit, or synthesize from username. auth.users.email must
  -- be ASCII, so a non-ASCII (e.g. Hebrew) username falls back to a stable
  -- hash-based local-part while the readable username is still kept on the
  -- profile row for login-by-username lookups.
  IF p_email IS NOT NULL AND length(trim(p_email)) > 0 THEN
    v_email := lower(trim(p_email));
  ELSIF v_username IS NOT NULL THEN
    v_ascii := regexp_replace(v_username, '[^a-z0-9_\.]', '', 'g');
    IF length(v_ascii) >= 2 THEN
      v_email := v_ascii || '@users.local';
    ELSE
      v_email := 'u' || substr(md5(v_username), 1, 12) || '@users.local';
    END IF;
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

CREATE OR REPLACE FUNCTION public.admin_set_password(
  p_user_id uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.app_roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_caller AND r.name = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can set passwords';
  END IF;

  IF p_password IS NULL OR length(p_password) < 1 THEN
    RAISE EXCEPTION 'Password is required';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = crypt(p_password, gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    raw_app_meta_data = jsonb_set(
      COALESCE(raw_app_meta_data, '{}'::jsonb),
      '{providers}',
      (
        SELECT jsonb_agg(DISTINCT v)
        FROM jsonb_array_elements_text(
          COALESCE(raw_app_meta_data->'providers', '[]'::jsonb) || '["email"]'::jsonb
        ) AS v
      )
    ),
    updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;
