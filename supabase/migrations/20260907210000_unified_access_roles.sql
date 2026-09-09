-- One role per identity/connectivity class. Existing memberships and content stay intact.
ALTER TABLE public.app_roles ADD COLUMN IF NOT EXISTS access_kind text;
CREATE UNIQUE INDEX IF NOT EXISTS app_roles_access_kind_unique ON public.app_roles(access_kind) WHERE access_kind IS NOT NULL;

DO $$
DECLARE
  baseline uuid;
  kind text;
  role_label text;
  target uuid;
BEGIN
  SELECT id INTO baseline FROM public.app_roles
    WHERE name IN ('משתמש רשום', 'user') AND name <> 'admin'
    ORDER BY (name = 'משתמש רשום') DESC LIMIT 1;
  IF baseline IS NULL THEN RAISE EXCEPTION 'Registered user role is required'; END IF;
  UPDATE public.app_roles SET access_kind = 'registered', is_system = true WHERE id = baseline;
  UPDATE public.app_roles SET access_kind = 'admin' WHERE name = 'admin';
  FOREACH kind IN ARRAY ARRAY['anonymous_online','registered_offline','anonymous_offline'] LOOP
    role_label := CASE kind WHEN 'anonymous_online' THEN 'משתמש אנונימי אונליין'
      WHEN 'registered_offline' THEN 'משתמש רשום אופליין' ELSE 'משתמש אנונימי אופליין' END;
    SELECT id INTO target FROM public.app_roles WHERE access_kind = kind;
    IF target IS NULL THEN
      INSERT INTO public.app_roles(name,description,is_system,access_kind)
        VALUES(role_label, 'הרשאות עצמאיות; נוצרו לפי משתמש רשום', true, kind) RETURNING id INTO target;
      INSERT INTO public.role_permissions(role_id,module,action,allowed)
        SELECT target,module,action,allowed FROM public.role_permissions WHERE role_id = baseline;
    END IF;
  END LOOP;
END;
$$;

-- Safe public policy: no identities, private data or admin permissions are returned.
CREATE OR REPLACE FUNCTION public.get_access_role_policy()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_object_agg(r.access_kind, jsonb_build_object(
    'id', r.id, 'name', r.name, 'matrix', COALESCE((
      SELECT jsonb_object_agg(p.module::text || ':' || p.action::text, p.allowed)
      FROM public.role_permissions p WHERE p.role_id = r.id
    ), '{}'::jsonb)))
  FROM public.app_roles r WHERE r.access_kind IN
    ('registered','anonymous_online','registered_offline','anonymous_offline');
$$;
REVOKE ALL ON FUNCTION public.get_access_role_policy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_access_role_policy() TO anon, authenticated;

-- Every real account receives registered-user access, regardless of how it was created.
-- Additional assigned roles are additive, explicit personal overrides take priority.
CREATE OR REPLACE FUNCTION public.has_permission(
  _user_id uuid, _module public.permission_module, _action public.permission_action
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE explicit_allowed boolean;
BEGIN
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN RETURN false; END IF;
  IF public.is_admin(_user_id) THEN RETURN true; END IF;
  SELECT allowed INTO explicit_allowed FROM public.user_permission_overrides
    WHERE user_id = _user_id AND module = _module AND action = _action LIMIT 1;
  IF FOUND THEN RETURN explicit_allowed; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions p JOIN public.app_roles r ON r.id = p.role_id
    WHERE p.module = _module AND p.action = _action AND p.allowed
      AND (r.access_kind = 'registered' OR (r.access_kind IS NULL AND EXISTS (
        SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role_id = r.id
      )))
  );
END;
$$;

-- Signup always starts as a registered user. Optional custom defaults are additive;
-- an administrator or offline/anonymous role must never be an automatic signup role.
CREATE OR REPLACE FUNCTION public.admin_set_default_signup_role(p_role_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.app_roles WHERE id=p_role_id AND name <> 'admin'
      AND (access_kind IS NULL OR access_kind='registered')
  ) THEN RAISE EXCEPTION 'Only a registered or custom role can be a signup default'; END IF;
  UPDATE public.app_roles SET is_default_for_signup=false WHERE is_default_for_signup;
  UPDATE public.app_roles SET is_default_for_signup=true WHERE id=COALESCE(p_role_id,
    (SELECT id FROM public.app_roles WHERE access_kind='registered'));
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles(user_id,role_id)
    SELECT new.id,id FROM public.app_roles WHERE access_kind='registered'
      OR (is_default_for_signup AND access_kind IS NULL AND name <> 'admin')
    ON CONFLICT DO NOTHING;
  RETURN new;
END;
$$;

-- Initial independent profile copies: preserve the registered user's current layout,
-- visibility and permissions without giving all four roles a shared editable profile.
DO $$
DECLARE
  baseline uuid;
  r record;
  suffix text;
  profiles_key text;
  links_key text;
  blocks_key text;
  block_links_key text;
  profiles jsonb;
  links jsonb;
  blocks jsonb;
  block_links jsonb;
  source_profile jsonb;
  source_block jsonb;
  new_id text;
BEGIN
  SELECT id INTO baseline FROM public.app_roles WHERE access_kind = 'registered';
  FOREACH suffix IN ARRAY ARRAY['v1','mobile_v1'] LOOP
    profiles_key := 'role_layout_profiles_' || suffix;
    links_key := 'role_layout_profile_assignments_' || suffix;
    blocks_key := 'feature_blocklist_profiles_' || suffix;
    block_links_key := 'feature_blocklist_role_assignments_' || suffix;
    SELECT COALESCE(value,'[]'::jsonb) INTO profiles FROM public.site_settings WHERE key=profiles_key;
    SELECT COALESCE(value,'[]'::jsonb) INTO links FROM public.site_settings WHERE key=links_key;
    SELECT COALESCE(value,'[]'::jsonb) INTO blocks FROM public.site_settings WHERE key=blocks_key;
    SELECT COALESCE(value,'[]'::jsonb) INTO block_links FROM public.site_settings WHERE key=block_links_key;
    profiles := COALESCE(profiles,'[]'::jsonb); links := COALESCE(links,'[]'::jsonb);
    blocks := COALESCE(blocks,'[]'::jsonb); block_links := COALESCE(block_links,'[]'::jsonb);
    SELECT p INTO source_profile FROM jsonb_array_elements(profiles) p
      WHERE p->>'id' = (SELECT a->>'profileId' FROM jsonb_array_elements(links) a WHERE a->>'roleId'=baseline::text LIMIT 1) LIMIT 1;
    SELECT p INTO source_block FROM jsonb_array_elements(blocks) p
      WHERE p->>'id' = (SELECT a->>'profileId' FROM jsonb_array_elements(block_links) a WHERE a->>'roleId'=baseline::text LIMIT 1) LIMIT 1;
    FOR r IN SELECT id,name FROM public.app_roles WHERE access_kind IN ('anonymous_online','registered_offline','anonymous_offline') LOOP
      new_id := 'access-' || r.id::text;
      IF source_profile IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(links) a WHERE a->>'roleId'=r.id::text) THEN
        profiles := profiles || jsonb_build_array(source_profile || jsonb_build_object('id',new_id,'name',r.name));
        links := links || jsonb_build_array(jsonb_build_object('id',new_id,'roleId',r.id,'profileId',new_id));
      END IF;
      IF source_block IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(block_links) a WHERE a->>'roleId'=r.id::text) THEN
        blocks := blocks || jsonb_build_array(source_block || jsonb_build_object('id',new_id,'name',r.name));
        block_links := block_links || jsonb_build_array(jsonb_build_object('id',new_id,'roleId',r.id,'profileId',new_id));
      END IF;
    END LOOP;
    INSERT INTO public.site_settings(key,value) VALUES (profiles_key,profiles),(links_key,links),(blocks_key,blocks),(block_links_key,block_links)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  END LOOP;
END;
$$;
