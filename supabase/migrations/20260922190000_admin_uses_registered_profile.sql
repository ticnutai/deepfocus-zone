-- Administrators use the exact same default display/content profile as the
-- registered role. Security permissions remain administrator permissions;
-- only presentation and content-source choices are shared.
DO $$
DECLARE
  admin_role uuid;
  registered_role uuid;
  scope text;
  suffix text;
  profile_key text;
  block_key text;
  assignment_key text;
  block_assignment_key text;
  profiles jsonb;
  blocks jsonb;
  assignments jsonb;
  block_assignments jsonb;
  registered_profile_id text;
BEGIN
  SELECT id INTO admin_role FROM public.app_roles WHERE name='admin' LIMIT 1;
  SELECT id INTO registered_role FROM public.app_roles WHERE access_kind='registered' LIMIT 1;
  IF admin_role IS NULL OR registered_role IS NULL THEN
    RAISE EXCEPTION 'Required system role missing';
  END IF;

  FOREACH scope IN ARRAY ARRAY['desktop','mobile'] LOOP
    suffix:=CASE WHEN scope='mobile' THEN '_mobile_v1' ELSE '_v1' END;
    profile_key:='role_layout_profiles'||suffix;
    block_key:='feature_blocklist_profiles'||suffix;
    assignment_key:='role_layout_profile_assignments'||suffix;
    block_assignment_key:='feature_blocklist_role_assignments'||suffix;

    SELECT coalesce(value,'[]'::jsonb) INTO profiles
      FROM public.site_settings WHERE key=profile_key FOR UPDATE;
    SELECT coalesce(value,'[]'::jsonb) INTO blocks
      FROM public.site_settings WHERE key=block_key FOR UPDATE;
    SELECT coalesce(value,'[]'::jsonb) INTO assignments
      FROM public.site_settings WHERE key=assignment_key FOR UPDATE;
    SELECT coalesce(value,'[]'::jsonb) INTO block_assignments
      FROM public.site_settings WHERE key=block_assignment_key FOR UPDATE;

    SELECT x->>'profileId' INTO registered_profile_id
      FROM jsonb_array_elements(assignments) x
      WHERE x->>'roleId'=registered_role::text
      LIMIT 1;
    IF coalesce(registered_profile_id,'')='' THEN
      RAISE EXCEPTION 'Registered display profile missing for %',scope;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(profiles) x WHERE x->>'id'=registered_profile_id)
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(blocks) x WHERE x->>'id'=registered_profile_id) THEN
      RAISE EXCEPTION 'Registered profile pair is incomplete for %',scope;
    END IF;

    SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO assignments
      FROM jsonb_array_elements(assignments) x WHERE x->>'roleId'<>admin_role::text;
    SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO block_assignments
      FROM jsonb_array_elements(block_assignments) x WHERE x->>'roleId'<>admin_role::text;
    assignments:=assignments||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'roleId',admin_role,'profileId',registered_profile_id));
    block_assignments:=block_assignments||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'roleId',admin_role,'profileId',registered_profile_id));

    -- Remove the now-unassigned administrator copies. The registered profile
    -- remains the single editable source of truth for both roles.
    SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO profiles
      FROM jsonb_array_elements(profiles) x WHERE x->>'id' NOT LIKE 'access-admin-%';
    SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO blocks
      FROM jsonb_array_elements(blocks) x WHERE x->>'id' NOT LIKE 'access-admin-%';

    INSERT INTO public.site_settings(key,value) VALUES
      (profile_key,profiles),(block_key,blocks),
      (assignment_key,assignments),(block_assignment_key,block_assignments)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  END LOOP;

  -- The content resolver deliberately uses the administrator row when one is
  -- present, so keep that row byte-for-byte equivalent to the registered role.
  INSERT INTO public.role_content_access(
    role_id,include_own,include_site_library,approved_only,
    source_user_ids,source_tags,updated_at,updated_by
  )
  SELECT admin_role,include_own,include_site_library,approved_only,
    source_user_ids,source_tags,now(),auth.uid()
  FROM public.role_content_access WHERE role_id=registered_role
  ON CONFLICT(role_id) DO UPDATE SET
    include_own=excluded.include_own,
    include_site_library=excluded.include_site_library,
    approved_only=excluded.approved_only,
    source_user_ids=excluded.source_user_ids,
    source_tags=excluded.source_tags,
    updated_at=now(),updated_by=auth.uid();

  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Administrator security marker lost; rolling back';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.site_settings s
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.value,'[]'::jsonb)) x
    WHERE s.key IN (
      'role_layout_profiles_v1','role_layout_profiles_mobile_v1',
      'feature_blocklist_profiles_v1','feature_blocklist_profiles_mobile_v1'
    ) AND x->>'id' LIKE 'access-admin-%'
  ) THEN
    RAISE EXCEPTION 'Duplicate administrator profile remains; rolling back';
  END IF;
  IF EXISTS(
    SELECT 1
    FROM (VALUES
      ('role_layout_profile_assignments_v1'),('role_layout_profile_assignments_mobile_v1'),
      ('feature_blocklist_role_assignments_v1'),('feature_blocklist_role_assignments_mobile_v1')
    ) keys(key)
    CROSS JOIN LATERAL (
      SELECT
        (SELECT x->>'profileId' FROM public.site_settings s
         CROSS JOIN LATERAL jsonb_array_elements(s.value) x
         WHERE s.key=keys.key AND x->>'roleId'=admin_role::text LIMIT 1) admin_profile,
        (SELECT x->>'profileId' FROM public.site_settings s
         CROSS JOIN LATERAL jsonb_array_elements(s.value) x
         WHERE s.key=keys.key AND x->>'roleId'=registered_role::text LIMIT 1) registered_profile
    ) resolved
    WHERE admin_profile IS DISTINCT FROM registered_profile
  ) THEN
    RAISE EXCEPTION 'Administrator and registered assignments differ; rolling back';
  END IF;
  IF EXISTS(
    SELECT 1
    FROM public.role_content_access admin_access
    JOIN public.role_content_access registered_access ON registered_access.role_id=registered_role
    WHERE admin_access.role_id=admin_role
      AND ROW(
        admin_access.include_own,admin_access.include_site_library,
        admin_access.approved_only,admin_access.source_user_ids,admin_access.source_tags
      ) IS DISTINCT FROM ROW(
        registered_access.include_own,registered_access.include_site_library,
        registered_access.approved_only,registered_access.source_user_ids,registered_access.source_tags
      )
  ) OR NOT EXISTS(SELECT 1 FROM public.role_content_access WHERE role_id=admin_role) THEN
    RAISE EXCEPTION 'Administrator and registered content profiles differ; rolling back';
  END IF;
END $$;

NOTIFY pgrst,'reload schema';
