-- Repair approved on 2026-09-08. No users/content are deleted.
-- Preserve the exact prior overrides, role policy and profile settings for recovery.
CREATE TABLE IF NOT EXISTS public.access_role_repair_backups (
  id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL
);
ALTER TABLE public.access_role_repair_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.access_role_repair_backups FROM anon, authenticated;
GRANT SELECT ON public.access_role_repair_backups TO authenticated;
DROP POLICY IF EXISTS access_repair_admin_read ON public.access_role_repair_backups;
CREATE POLICY access_repair_admin_read ON public.access_role_repair_backups FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DO $$
DECLARE targets uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.access_role_repair_backups WHERE id='20260908010000') THEN
    SELECT array_agg(u.id) INTO targets FROM auth.users u WHERE NOT public.is_admin(u.id)
      AND EXISTS (SELECT 1 FROM public.role_permissions p JOIN public.app_roles r ON r.id=p.role_id
        WHERE r.access_kind='registered' AND NOT p.allowed AND public.has_permission(u.id,p.module,p.action));
    IF COALESCE(cardinality(targets),0) <> 2 THEN RAISE EXCEPTION 'Expected exactly two approved override targets; re-audit before proceeding'; END IF;
    INSERT INTO public.access_role_repair_backups(id,snapshot) VALUES ('20260908010000',jsonb_build_object(
      'target_user_ids',to_jsonb(targets),
      'overrides',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]') FROM public.user_permission_overrides p WHERE user_id=ANY(targets)),
      'permissions',(SELECT jsonb_agg(to_jsonb(p)) FROM public.role_permissions p),
      'settings',(SELECT jsonb_agg(to_jsonb(s)) FROM public.site_settings s WHERE key LIKE 'role_layout_%' OR key LIKE 'feature_blocklist_%'),
      'policies',(SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE schemaname='public')
    ));
    DELETE FROM public.user_permission_overrides WHERE user_id=ANY(targets);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid,_module public.permission_module,_action public.permission_action)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE explicit_allowed boolean; anonymous_account boolean;
BEGIN
  SELECT is_anonymous INTO anonymous_account FROM auth.users WHERE id=_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.is_admin(_user_id) AND NOT COALESCE(anonymous_account,false) THEN RETURN true; END IF;
  IF _module IN ('users','roles') THEN RETURN false; END IF;
  IF _action <> 'view' AND NOT public.has_permission(_user_id,_module,'view') THEN RETURN false; END IF;
  IF NOT COALESCE(anonymous_account,false) THEN
    SELECT allowed INTO explicit_allowed FROM public.user_permission_overrides WHERE user_id=_user_id AND module=_module AND action=_action;
    IF FOUND THEN RETURN explicit_allowed; END IF;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.role_permissions p JOIN public.app_roles r ON r.id=p.role_id
    WHERE p.module=_module AND p.action=_action AND p.allowed AND
    (r.access_kind=CASE WHEN COALESCE(anonymous_account,false) THEN 'anonymous_online' ELSE 'registered' END
    OR (NOT COALESCE(anonymous_account,false) AND r.access_kind IS NULL AND EXISTS
      (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=_user_id AND ur.role_id=r.id))));
END $$;

-- Restrictive policies supplement (not replace) existing ownership/sharing rules.
DO $$
DECLARE t text; m text;
BEGIN
  FOR t,m IN SELECT * FROM (VALUES ('cards','cards'),('categories','cards'),('decks','decks'),('card_decks','decks'),('goals','goals')) v(t,m) LOOP
    EXECUTE format('DROP POLICY IF EXISTS access_role_view ON public.%I',t);
    EXECUTE format('CREATE POLICY access_role_view ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),%L,''view''))',t,m);
    EXECUTE format('DROP POLICY IF EXISTS access_role_create ON public.%I',t);
    EXECUTE format('CREATE POLICY access_role_create ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),%L,%L))',t,m,CASE WHEN t='card_decks' THEN 'edit' ELSE 'create' END);
    EXECUTE format('DROP POLICY IF EXISTS access_role_edit ON public.%I',t);
    EXECUTE format('CREATE POLICY access_role_edit ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),%L,''edit'')) WITH CHECK (public.has_permission(auth.uid(),%L,''edit''))',t,m,m);
    EXECUTE format('DROP POLICY IF EXISTS access_role_delete ON public.%I',t);
    EXECUTE format('CREATE POLICY access_role_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),%L,%L))',t,m,CASE WHEN t='card_decks' THEN 'edit' ELSE 'delete' END);
  END LOOP;
END $$;

-- One transactional writer for layout, visibility, assignments and explicit permission edits.
-- Soft deletion must require delete, not merely edit. Reviewing a card may
-- update only its study progress with view permission, without editing content.
CREATE OR REPLACE FUNCTION public.enforce_content_update_permission()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE m public.permission_module; old_content jsonb; new_content jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  m:=CASE WHEN TG_TABLE_NAME='decks' THEN 'decks' ELSE 'cards' END;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL
    AND NOT public.has_permission(auth.uid(),m,'delete') THEN RAISE EXCEPTION 'Delete permission required' USING ERRCODE='42501'; END IF;
  old_content:=to_jsonb(OLD)-ARRAY['updated_at','deleted_at'];
  new_content:=to_jsonb(NEW)-ARRAY['updated_at','deleted_at'];
  IF TG_TABLE_NAME='cards' THEN
    old_content:=old_content-ARRAY['srs','stats']; new_content:=new_content-ARRAY['srs','stats'];
  END IF;
  IF (new_content IS DISTINCT FROM old_content OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL))
    AND NOT public.has_permission(auth.uid(),m,'edit') THEN RAISE EXCEPTION 'Edit permission required' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE t text; m text;
BEGIN
  FOR t,m IN SELECT * FROM (VALUES ('cards','cards'),('categories','cards'),('decks','decks')) v(t,m) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS access_content_update ON public.%I',t);
    EXECUTE format('CREATE TRIGGER access_content_update BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_content_update_permission()',t);
    EXECUTE format('DROP POLICY access_role_edit ON public.%I',t);
    EXECUTE format('CREATE POLICY access_role_edit ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),%L,''view'')) WITH CHECK (public.has_permission(auth.uid(),%L,''view''))',t,m,m);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_save_access_profile(
  p_scope text,p_layout jsonb,p_block jsonb,p_role_ids uuid[],
  p_permissions jsonb DEFAULT NULL,p_expected_permissions jsonb DEFAULT NULL,
  p_expected_updated_at bigint DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE suffix text; pk text; bk text; ak text; ck text; pid text; profiles jsonb; blocks jsonb; links jsonb; blinks jsonb;
  current_version bigint; actual_permissions jsonb; roles uuid[]; stamp bigint;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('desktop','mobile') OR jsonb_typeof(p_layout) IS DISTINCT FROM 'object' OR jsonb_typeof(p_block) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid profile'; END IF;
  pid:=p_layout->>'id';
  IF pid IS NULL OR pid='' OR p_block->>'id' IS DISTINCT FROM pid OR COALESCE(btrim(p_layout->>'name'),'')='' THEN RAISE EXCEPTION 'Invalid profile identity'; END IF;
  SELECT COALESCE(array_agg(DISTINCT x),'{}'::uuid[]) INTO roles FROM unnest(COALESCE(p_role_ids,'{}'::uuid[])) x;
  IF EXISTS (SELECT 1 FROM unnest(roles) x LEFT JOIN public.app_roles r ON r.id=x WHERE r.id IS NULL OR r.name='admin') THEN RAISE EXCEPTION 'Invalid role assignment'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('access-profile-writer'));
  suffix:=CASE WHEN p_scope='mobile' THEN '_mobile_v1' ELSE '_v1' END;
  pk:='role_layout_profiles'||suffix; bk:='feature_blocklist_profiles'||suffix;
  ak:='role_layout_profile_assignments'||suffix; ck:='feature_blocklist_role_assignments'||suffix;
  SELECT COALESCE(value,'[]') INTO profiles FROM public.site_settings WHERE key=pk;
  SELECT COALESCE(value,'[]') INTO blocks FROM public.site_settings WHERE key=bk;
  SELECT COALESCE(value,'[]') INTO links FROM public.site_settings WHERE key=ak;
  SELECT COALESCE(value,'[]') INTO blinks FROM public.site_settings WHERE key=ck;
  profiles:=COALESCE(profiles,'[]'); blocks:=COALESCE(blocks,'[]'); links:=COALESCE(links,'[]'); blinks:=COALESCE(blinks,'[]');
  SELECT max((x->>'updatedAt')::bigint) INTO current_version FROM jsonb_array_elements(profiles||blocks) x WHERE x->>'id'=pid;
  IF current_version IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'הפרופיל השתנה בחלון אחר. רענן לפני שמירה'; END IF;
  IF p_permissions IS NOT NULL THEN
    IF jsonb_typeof(p_permissions)<>'array' THEN RAISE EXCEPTION 'Invalid permission edits'; END IF;
    PERFORM 1 FROM public.role_permissions WHERE role_id=ANY(roles) FOR UPDATE;
    SELECT COALESCE(jsonb_object_agg(role_id::text||':'||module::text||':'||action::text,allowed),'{}') INTO actual_permissions FROM public.role_permissions WHERE role_id=ANY(roles);
    IF actual_permissions IS DISTINCT FROM p_expected_permissions THEN RAISE EXCEPTION 'ההרשאות השתנו בחלון או בתצוגה אחרת. רענן לפני שמירה'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_permissions) x WHERE NOT ((x->>'role_id')::uuid=ANY(roles)) OR x->>'module' NOT IN ('cards','decks','goals','shas','analytics','settings') OR x->>'action' NOT IN ('view','create','edit','delete','manage') OR jsonb_typeof(x->'allowed')<>'boolean') THEN RAISE EXCEPTION 'Invalid permission rows'; END IF;
  ELSIF EXISTS (SELECT 1 FROM unnest(roles) r WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(links) x WHERE x->>'roleId'=r::text AND x->>'profileId'=pid)) THEN
    RAISE EXCEPTION 'New role assignments require explicit permission confirmation';
  END IF;
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  SELECT COALESCE(jsonb_agg(x),'[]') INTO profiles FROM jsonb_array_elements(profiles) x WHERE x->>'id'<>pid;
  SELECT COALESCE(jsonb_agg(x),'[]') INTO blocks FROM jsonb_array_elements(blocks) x WHERE x->>'id'<>pid;
  profiles:=profiles||jsonb_build_array(p_layout||jsonb_build_object('updatedAt',stamp));
  blocks:=blocks||jsonb_build_array(p_block||jsonb_build_object('updatedAt',stamp));
  SELECT COALESCE(jsonb_agg(x),'[]') INTO links FROM jsonb_array_elements(links) x WHERE x->>'profileId'<>pid AND NOT ((x->>'roleId')=ANY(roles::text[]));
  SELECT COALESCE(jsonb_agg(x),'[]') INTO blinks FROM jsonb_array_elements(blinks) x WHERE x->>'profileId'<>pid AND NOT ((x->>'roleId')=ANY(roles::text[]));
  links:=links||COALESCE((SELECT jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'roleId',r,'profileId',pid)) FROM unnest(roles) r),'[]');
  blinks:=blinks||COALESCE((SELECT jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'roleId',r,'profileId',pid)) FROM unnest(roles) r),'[]');
  INSERT INTO public.site_settings(key,value) VALUES (pk,profiles),(bk,blocks),(ak,links),(ck,blinks) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
  IF p_permissions IS NOT NULL THEN
    INSERT INTO public.role_permissions(role_id,module,action,allowed)
      SELECT (x->>'role_id')::uuid,(x->>'module')::public.permission_module,(x->>'action')::public.permission_action,(x->>'allowed')::boolean FROM jsonb_array_elements(p_permissions) x
      ON CONFLICT(role_id,module,action) DO UPDATE SET allowed=EXCLUDED.allowed;
  END IF;
  IF p_scope='desktop' THEN DELETE FROM public.role_layout_defaults WHERE role_id=ANY(roles); END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_access_profile(text,jsonb,jsonb,uuid[],jsonb,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_access_profile(text,jsonb,jsonb,uuid[],jsonb,jsonb,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_access_profile(p_scope text,p_profile_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE suffix text; k text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('desktop','mobile') THEN RAISE EXCEPTION 'Invalid scope'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('access-profile-writer'));
  suffix:=CASE WHEN p_scope='mobile' THEN '_mobile_v1' ELSE '_v1' END;
  IF EXISTS (SELECT 1 FROM public.site_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value) x WHERE s.key IN ('role_layout_profile_assignments'||suffix,'feature_blocklist_role_assignments'||suffix) AND x->>'profileId'=p_profile_id) THEN RAISE EXCEPTION 'ראשית שייך את התפקידים לפרופיל אחר'; END IF;
  FOREACH k IN ARRAY ARRAY['role_layout_profiles'||suffix,'feature_blocklist_profiles'||suffix] LOOP
    UPDATE public.site_settings SET value=(SELECT COALESCE(jsonb_agg(x),'[]') FROM jsonb_array_elements(value) x WHERE x->>'id'<>p_profile_id) WHERE key=k;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_delete_access_profile(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_access_profile(text,text) TO authenticated;

-- Even an old client can no longer bypass the atomic profile writer.
DO $$
DECLARE predicate text;
BEGIN
  predicate:=$p$key NOT IN ('role_layout_profiles_v1','role_layout_profiles_mobile_v1','role_layout_profile_assignments_v1','role_layout_profile_assignments_mobile_v1','feature_blocklist_profiles_v1','feature_blocklist_profiles_mobile_v1','feature_blocklist_role_assignments_v1','feature_blocklist_role_assignments_mobile_v1')$p$;
  DROP POLICY IF EXISTS access_profile_atomic_insert ON public.site_settings;
  DROP POLICY IF EXISTS access_profile_atomic_update ON public.site_settings;
  DROP POLICY IF EXISTS access_profile_atomic_delete ON public.site_settings;
  EXECUTE 'CREATE POLICY access_profile_atomic_insert ON public.site_settings AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ('||predicate||')';
  EXECUTE 'CREATE POLICY access_profile_atomic_update ON public.site_settings AS RESTRICTIVE FOR UPDATE TO authenticated USING ('||predicate||') WITH CHECK ('||predicate||')';
  EXECUTE 'CREATE POLICY access_profile_atomic_delete ON public.site_settings AS RESTRICTIVE FOR DELETE TO authenticated USING ('||predicate||')';
END $$;
