-- Allow admins to set/reset a password for any user.
-- This enables Google OAuth users to also log in via email+password.

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
  -- Verify caller is admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.app_roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_caller AND r.name = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can set passwords';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  -- Update password and ensure email provider is included
  UPDATE auth.users
  SET
    encrypted_password = crypt(p_password, gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    -- Add "email" to providers list if not already there
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

GRANT EXECUTE ON FUNCTION public.admin_set_password(uuid, text) TO authenticated;
