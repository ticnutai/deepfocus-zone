-- Only an explicit administrator replacement disables the registered baseline.
-- Existing assignments and personal overrides are preserved. No content is deleted.
CREATE TEMP TABLE role_permission_before ON COMMIT DROP AS
SELECT u.id,p.module,p.action,public.has_permission(u.id,p.module,p.action) AS allowed
FROM auth.users u CROSS JOIN (SELECT DISTINCT module,action FROM public.role_permissions) p;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role_baseline_enabled boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.guard_role_baseline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (TG_OP='INSERT' AND NOT NEW.role_baseline_enabled) OR
    (TG_OP='UPDATE' AND NEW.role_baseline_enabled IS DISTINCT FROM OLD.role_baseline_enabled) THEN
  IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_role_baseline BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_role_baseline();
CREATE OR REPLACE FUNCTION public.effective_access_role_ids(p_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH identity AS (
  SELECT coalesce((SELECT is_anonymous FROM auth.users WHERE id=p_user_id),true) AS anonymous
 ), custom AS (
  SELECT r.id FROM public.app_roles r JOIN public.user_roles u ON u.role_id=r.id
  WHERE u.user_id=p_user_id AND r.access_kind IS NULL AND NOT (SELECT anonymous FROM identity)
 )
 SELECT id FROM custom
 UNION
 SELECT r.id FROM public.app_roles r WHERE ((SELECT anonymous FROM identity)
 OR coalesce((SELECT role_baseline_enabled FROM public.profiles WHERE id=p_user_id),true))
 AND r.access_kind=CASE WHEN (SELECT anonymous FROM identity) THEN 'anonymous_online' ELSE 'registered' END;
$$;
REVOKE ALL ON FUNCTION public.effective_access_role_ids(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid,_module public.permission_module,_action public.permission_action)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE explicit_allowed boolean; anonymous_account boolean;
BEGIN
 SELECT is_anonymous INTO anonymous_account FROM auth.users WHERE id=_user_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF public.is_admin(_user_id) AND NOT coalesce(anonymous_account,false) THEN RETURN true; END IF;
 IF _module IN ('users','roles') THEN RETURN false; END IF;
 IF _action<>'view' AND NOT public.has_permission(_user_id,_module,'view') THEN RETURN false; END IF;
 IF NOT coalesce(anonymous_account,false) THEN
  SELECT allowed INTO explicit_allowed FROM public.user_permission_overrides
  WHERE user_id=_user_id AND module=_module AND action=_action;
  IF FOUND THEN RETURN explicit_allowed; END IF;
 END IF;
 RETURN EXISTS(SELECT 1 FROM public.role_permissions p
  WHERE p.role_id IN (SELECT public.effective_access_role_ids(_user_id))
  AND p.module=_module AND p.action=_action AND p.allowed);
END; $$;

-- Preserve all current source-union and moderation logic; change only role selection.
DO $$ DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('public.get_effective_content_access()'::regprocedure);
 changed:=regexp_replace(original,'with effective_roles as \([\s\S]*?\), rules as',
  'with effective_roles as (select public.effective_access_role_ids(v_uid) as id), rules as','i');
 IF changed=original THEN RAISE EXCEPTION 'Content role resolver drift: review before applying'; END IF;
 EXECUTE changed;
 original:=pg_get_functiondef('public.get_effective_question_source_tags()'::regprocedure);
 changed:=regexp_replace(original,'WITH roles AS \([\s\S]*?\) SELECT',
  'WITH roles AS (SELECT public.effective_access_role_ids(auth.uid()) AS id) SELECT','i');
 IF changed=original THEN RAISE EXCEPTION 'Source role resolver drift: review before applying'; END IF;
 EXECUTE changed;
END; $$;

-- A role replacement is atomic. A failed request cannot leave the user roleless.
CREATE OR REPLACE FUNCTION public.admin_replace_user_role(p_user_id uuid,p_role_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE chosen public.app_roles;
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('admin-role-replacement'));
 PERFORM 1 FROM auth.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
 SELECT * INTO chosen FROM public.app_roles WHERE id=p_role_id;
 IF NOT FOUND OR (chosen.access_kind IS NOT NULL AND chosen.access_kind NOT IN ('registered','admin')) THEN
  RAISE EXCEPTION 'Select a custom role or the registered default';
 END IF;
 IF public.is_admin(p_user_id) AND chosen.name<>'admin' THEN
  IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'Cannot demote your own administrator account'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.app_roles r ON r.id=u.role_id WHERE r.name='admin' AND u.user_id<>p_user_id) THEN
   RAISE EXCEPTION 'Cannot remove the last administrator';
  END IF;
 END IF;
 DELETE FROM public.user_roles WHERE user_id=p_user_id;
 UPDATE public.profiles SET role_baseline_enabled=coalesce(chosen.access_kind='registered',false) WHERE id=p_user_id;
 INSERT INTO public.user_roles(user_id,role_id,assigned_by) VALUES(p_user_id,p_role_id,auth.uid());
END; $$;
REVOKE ALL ON FUNCTION public.admin_replace_user_role(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_replace_user_role(uuid,uuid) TO authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM role_permission_before b WHERE public.has_permission(b.id,b.module,b.action) IS DISTINCT FROM b.allowed) THEN
  RAISE EXCEPTION 'Existing user permissions changed; rolling back migration';
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
