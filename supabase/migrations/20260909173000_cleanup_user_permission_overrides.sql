-- Keep per-user permission overrides tied to real authentication users.
-- The backup makes the one-time orphan cleanup recoverable.

CREATE TABLE IF NOT EXISTS public.access_role_repair_backups (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL
);

INSERT INTO public.access_role_repair_backups (id, snapshot)
SELECT
  '20260909173000-orphan-permission-overrides',
  jsonb_build_object(
    'rows', COALESCE(jsonb_agg(to_jsonb(upo)), '[]'::jsonb),
    'count', count(*)
  )
FROM public.user_permission_overrides upo
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = upo.user_id)
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.user_permission_overrides upo
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = upo.user_id);

UPDATE public.user_permission_overrides upo
SET set_by = NULL
WHERE set_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = upo.set_by);

ALTER TABLE public.user_permission_overrides
  DROP CONSTRAINT IF EXISTS user_permission_overrides_user_id_fkey,
  DROP CONSTRAINT IF EXISTS user_permission_overrides_set_by_fkey;

ALTER TABLE public.user_permission_overrides
  ADD CONSTRAINT user_permission_overrides_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT user_permission_overrides_set_by_fkey
    FOREIGN KEY (set_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Defense in depth: deletion remains complete even if a restored legacy schema
-- temporarily lacks the foreign key.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;
  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  DELETE FROM public.user_permission_overrides WHERE user_id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

