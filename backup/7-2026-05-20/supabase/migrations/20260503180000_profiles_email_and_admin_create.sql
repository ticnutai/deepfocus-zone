-- 1. Add email column to profiles, backfill, and keep in sync via trigger.
-- 2. Add an admin-only RPC to create new users (email + password + display_name + roles + status).

-- ──────────────────────────────────────────────────────────────────
-- Profiles.email
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email <> u.email);

CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (lower(email));

-- Trigger: keep email in sync from auth.users
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_email_trigger ON auth.users;
CREATE TRIGGER sync_profile_email_trigger
AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

-- ──────────────────────────────────────────────────────────────────
-- admin_create_user(email, password, display_name, role_name, status)
-- Creates auth.users row + profile + assigns role.
-- Caller must be admin (checked via has_role).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_display_name text DEFAULT NULL,
  p_role_name text DEFAULT 'user',
  p_status text DEFAULT 'approved'
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
BEGIN
  -- Verify caller is admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.app_roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_caller AND r.name = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can create users';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  -- Check for existing user
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email);
  IF v_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'User with email % already exists', p_email;
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
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', COALESCE(p_display_name, split_part(p_email,'@',1))),
    false, '', ''
  );

  -- Profile (trigger may also do this, but be explicit)
  INSERT INTO public.profiles (id, display_name, email, status)
  VALUES (
    v_user_id,
    COALESCE(p_display_name, split_part(p_email,'@',1)),
    lower(p_email),
    COALESCE(p_status, 'approved')
  )
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        status = EXCLUDED.status;

  -- Assign role
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

REVOKE ALL ON FUNCTION public.admin_create_user(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- admin_delete_user — for the delete button
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;

  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- admin_update_user — display_name + email + status
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_display_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
    RAISE EXCEPTION 'Only admins can update users';
  END IF;

  IF p_email IS NOT NULL AND length(trim(p_email)) > 0 THEN
    UPDATE auth.users SET email = lower(p_email), updated_at = now() WHERE id = p_user_id;
    UPDATE public.profiles SET email = lower(p_email) WHERE id = p_user_id;
  END IF;

  IF p_display_name IS NOT NULL THEN
    UPDATE public.profiles SET display_name = p_display_name WHERE id = p_user_id;
  END IF;

  IF p_status IS NOT NULL THEN
    UPDATE public.profiles SET status = p_status WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, text) TO authenticated;
