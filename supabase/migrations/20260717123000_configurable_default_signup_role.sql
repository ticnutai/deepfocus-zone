-- Let administrators choose (or clear) the role assigned to newly registered users.
ALTER TABLE public.app_roles
ADD COLUMN IF NOT EXISTS is_default_for_signup boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS app_roles_single_signup_default_idx
ON public.app_roles (is_default_for_signup)
WHERE is_default_for_signup = true;

-- Preserve the current site's intended behaviour on first deployment. Prefer
-- the role already assigned to Elazar Kramer (the reference account requested
-- by the administrator), then fall back to the usual registered-user names.
UPDATE public.app_roles
SET is_default_for_signup = true
WHERE id = COALESCE(
  (
    SELECT ur.role_id
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.display_name ILIKE '%אלעזר%קרמר%'
       OR p.display_name ILIKE '%אליעזר%קרמר%'
       OR lower(COALESCE(p.email, '')) = 'elazarkr100@gmail.com'
    ORDER BY ur.assigned_at
    LIMIT 1
  ),
  (
    SELECT id
    FROM public.app_roles
    WHERE lower(name) = 'user' OR name = 'משתמש רשום'
    ORDER BY CASE WHEN name = 'משתמש רשום' THEN 0 ELSE 1 END
    LIMIT 1
  )
)
AND NOT EXISTS (
  SELECT 1 FROM public.app_roles WHERE is_default_for_signup = true
);

CREATE OR REPLACE FUNCTION public.admin_set_default_signup_role(p_role_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.app_roles WHERE id = p_role_id
  ) THEN
    RAISE EXCEPTION 'Role not found';
  END IF;

  UPDATE public.app_roles
  SET is_default_for_signup = false
  WHERE is_default_for_signup = true;

  IF p_role_id IS NOT NULL THEN
    UPDATE public.app_roles
    SET is_default_for_signup = true
    WHERE id = p_role_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_default_signup_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_default_signup_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_role_id uuid;
BEGIN
  SELECT id INTO default_role_id
  FROM public.app_roles
  WHERE is_default_for_signup = true
  LIMIT 1;

  IF default_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles(user_id, role_id)
    VALUES (new.id, default_role_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_default_role() FROM PUBLIC, anon, authenticated;

-- Approval is the final safety net: if an older/pending account has no role,
-- give it the currently configured default role when it is approved.
CREATE OR REPLACE FUNCTION public.admin_set_profile_status(
  p_user_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  default_role_id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_status NOT IN ('approved', 'blocked') THEN
    RAISE EXCEPTION 'Invalid profile status';
  END IF;

  UPDATE public.profiles
  SET status = p_status
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF p_status = 'approved' THEN
    UPDATE auth.users
    SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = p_user_id;

    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id) THEN
      SELECT id INTO default_role_id
      FROM public.app_roles
      WHERE is_default_for_signup = true
      LIMIT 1;

      IF default_role_id IS NOT NULL THEN
        INSERT INTO public.user_roles(user_id, role_id, assigned_by)
        VALUES (p_user_id, default_role_id, auth.uid())
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_status(uuid, text) TO authenticated;

-- Repair already-approved accounts that were left without any role.
INSERT INTO public.user_roles (user_id, role_id)
SELECT p.id, r.id
FROM public.profiles p
CROSS JOIN public.app_roles r
WHERE p.status = 'approved'
  AND r.is_default_for_signup = true
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id
  )
ON CONFLICT DO NOTHING;
