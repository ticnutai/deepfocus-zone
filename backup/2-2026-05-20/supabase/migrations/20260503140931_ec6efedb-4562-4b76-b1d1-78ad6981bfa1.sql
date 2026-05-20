-- 1. profiles.status
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';

-- 2. approved_emails
CREATE TABLE IF NOT EXISTS public.approved_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  note text,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.approved_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_emails_admin_all ON public.approved_emails;
CREATE POLICY approved_emails_admin_all ON public.approved_emails
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 3. user_permission_overrides
CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  module public.permission_module NOT NULL,
  action public.permission_action NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  set_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module, action)
);
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS upo_admin_all ON public.user_permission_overrides;
CREATE POLICY upo_admin_all ON public.user_permission_overrides
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS upo_select_own ON public.user_permission_overrides;
CREATE POLICY upo_select_own ON public.user_permission_overrides
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());