-- Give administrators an independently editable display/content profile while
-- keeping public.is_admin()/has_permission() fully privileged.
CREATE OR REPLACE FUNCTION public.admin_assign_admin_access_profile(
  p_scope text,
  p_profile_id text,
  p_assigned boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  admin_role uuid;
  suffix text;
  profiles_key text;
  links_key text;
  blocks_key text;
  block_links_key text;
  profiles jsonb;
  links jsonb;
  block_links jsonb;
  profile jsonb;
  content jsonb;
  source_ids uuid[];
  source_tags text[];
BEGIN
  IF NOT coalesce(public.is_admin(auth.uid()),false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
  END IF;
  IF p_scope NOT IN ('desktop','mobile') OR coalesce(p_profile_id,'')='' THEN
    RAISE EXCEPTION 'Invalid profile assignment';
  END IF;
  SELECT id INTO admin_role FROM public.app_roles WHERE name='admin' LIMIT 1;
  IF admin_role IS NULL THEN RAISE EXCEPTION 'Administrator role missing'; END IF;

  suffix:=CASE WHEN p_scope='mobile' THEN '_mobile_v1' ELSE '_v1' END;
  profiles_key:='role_layout_profiles'||suffix;
  links_key:='role_layout_profile_assignments'||suffix;
  blocks_key:='feature_blocklist_profiles'||suffix;
  block_links_key:='feature_blocklist_role_assignments'||suffix;
  SELECT coalesce(value,'[]') INTO profiles FROM public.site_settings WHERE key=profiles_key;
  SELECT x INTO profile FROM jsonb_array_elements(coalesce(profiles,'[]')) x WHERE x->>'id'=p_profile_id LIMIT 1;
  IF profile IS NULL THEN RAISE EXCEPTION 'Unknown display profile'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.site_settings s CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.value,'[]')) x WHERE s.key=blocks_key AND x->>'id'=p_profile_id) THEN
    RAISE EXCEPTION 'Matching blocklist profile missing';
  END IF;

  SELECT coalesce(value,'[]') INTO links FROM public.site_settings WHERE key=links_key FOR UPDATE;
  SELECT coalesce(value,'[]') INTO block_links FROM public.site_settings WHERE key=block_links_key FOR UPDATE;
  SELECT coalesce(jsonb_agg(x),'[]') INTO links FROM jsonb_array_elements(coalesce(links,'[]')) x WHERE x->>'roleId'<>admin_role::text;
  SELECT coalesce(jsonb_agg(x),'[]') INTO block_links FROM jsonb_array_elements(coalesce(block_links,'[]')) x WHERE x->>'roleId'<>admin_role::text;
  IF p_assigned THEN
    links:=links||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'roleId',admin_role,'profileId',p_profile_id));
    block_links:=block_links||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'roleId',admin_role,'profileId',p_profile_id));
  END IF;
  INSERT INTO public.site_settings(key,value) VALUES(links_key,links),(block_links_key,block_links)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;

  IF p_assigned THEN
    content:=coalesce(profile->'contentAccess','{}'::jsonb);
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO source_ids
      FROM jsonb_array_elements_text(coalesce(content->'sourceUserIds','[]'::jsonb));
    SELECT coalesce(array_agg(DISTINCT value),'{}'::text[]) INTO source_tags
      FROM jsonb_array_elements_text(coalesce(content->'sourceTags','[]'::jsonb));
    INSERT INTO public.role_content_access(role_id,include_own,include_site_library,approved_only,source_user_ids,source_tags,updated_at,updated_by)
    VALUES(admin_role,coalesce((content->>'includeOwn')::boolean,true),coalesce((content->>'includeSiteLibrary')::boolean,false),
      coalesce((content->>'approvedOnly')::boolean,true),source_ids,source_tags,now(),auth.uid())
    ON CONFLICT(role_id) DO UPDATE SET include_own=excluded.include_own,include_site_library=excluded.include_site_library,
      approved_only=excluded.approved_only,source_user_ids=excluded.source_user_ids,source_tags=excluded.source_tags,
      updated_at=now(),updated_by=auth.uid();
  ELSE
    DELETE FROM public.role_content_access WHERE role_id=admin_role;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.admin_assign_admin_access_profile(text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_admin_access_profile(text,text,boolean) TO authenticated;

-- Resolve the dedicated administrator content row when present. Security
-- permissions continue to resolve through has_permission() and remain full.
CREATE OR REPLACE FUNCTION public.get_effective_content_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_include_own boolean:=true;
  v_include_central boolean:=false;
  v_approved_only boolean:=true;
  v_sources uuid[]:='{}';
  v_source_tags text[]:='{}';
  v_central uuid:=public.get_guest_source_user_id();
BEGIN
  WITH effective_roles AS (
    SELECT r.id FROM public.app_roles r
    WHERE r.name='admin' AND public.is_admin(v_uid)
      AND EXISTS(SELECT 1 FROM public.role_content_access a WHERE a.role_id=r.id)
    UNION
    SELECT public.effective_access_role_ids(v_uid)
    WHERE NOT (public.is_admin(v_uid) AND EXISTS(
      SELECT 1 FROM public.role_content_access a JOIN public.app_roles r ON r.id=a.role_id WHERE r.name='admin'))
  ), rules AS (
    SELECT a.* FROM public.role_content_access a JOIN effective_roles r ON r.id=a.role_id
  ), source_values AS (
    SELECT DISTINCT tag FROM rules LEFT JOIN LATERAL unnest(source_tags) tag ON true
  )
  SELECT coalesce((SELECT bool_or(include_own) FROM rules),true),
    coalesce((SELECT bool_or(include_site_library) FROM rules),false),
    coalesce((SELECT bool_and(approved_only) FROM rules),true),
    coalesce((SELECT array_agg(DISTINCT source_id) FILTER(WHERE source_id IS NOT NULL)
      FROM rules LEFT JOIN LATERAL unnest(source_user_ids) source_id ON true),'{}'::uuid[]),
    CASE WHEN coalesce((SELECT bool_or(include_site_library AND source_tags IS NULL) FROM rules),false)
      THEN NULL ELSE coalesce((SELECT array_agg(tag) FILTER(WHERE tag IS NOT NULL) FROM source_values),'{}'::text[]) END
  INTO v_include_own,v_include_central,v_approved_only,v_sources,v_source_tags;

  v_sources:=array(SELECT DISTINCT x FROM unnest(v_sources) x WHERE x IS DISTINCT FROM v_uid);
  RETURN jsonb_build_object('include_own',v_include_own,'include_site_library',v_include_central,
    'approved_only',v_approved_only,'source_user_ids',to_jsonb(v_sources),
    'central_source_user_id',v_central,'source_tags',to_jsonb(v_source_tags),
    'is_admin',coalesce(public.is_admin(v_uid),false));
END; $$;
REVOKE ALL ON FUNCTION public.get_effective_content_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_content_access() TO anon,authenticated;

-- Create the first independent administrator profile by cloning the current
-- registered profile. This preserves the choices already made by the owner.
DO $$
DECLARE
  admin_role uuid;
  registered_role uuid;
  scope text;
  suffix text;
  pk text; bk text; ak text; ck text;
  profiles jsonb; blocks jsonb; links jsonb; blinks jsonb;
  registered_profile_id text;
  source_profile jsonb; source_block jsonb;
  admin_profile_id text;
  stamp bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
BEGIN
  SELECT id INTO admin_role FROM public.app_roles WHERE name='admin' LIMIT 1;
  SELECT id INTO registered_role FROM public.app_roles WHERE access_kind='registered' LIMIT 1;
  IF admin_role IS NULL OR registered_role IS NULL THEN RAISE EXCEPTION 'Required system role missing'; END IF;
  FOREACH scope IN ARRAY ARRAY['desktop','mobile'] LOOP
    suffix:=CASE WHEN scope='mobile' THEN '_mobile_v1' ELSE '_v1' END;
    pk:='role_layout_profiles'||suffix; bk:='feature_blocklist_profiles'||suffix;
    ak:='role_layout_profile_assignments'||suffix; ck:='feature_blocklist_role_assignments'||suffix;
    SELECT coalesce(value,'[]') INTO profiles FROM public.site_settings WHERE key=pk;
    SELECT coalesce(value,'[]') INTO blocks FROM public.site_settings WHERE key=bk;
    SELECT coalesce(value,'[]') INTO links FROM public.site_settings WHERE key=ak;
    SELECT coalesce(value,'[]') INTO blinks FROM public.site_settings WHERE key=ck;
    SELECT x->>'profileId' INTO registered_profile_id FROM jsonb_array_elements(links) x WHERE x->>'roleId'=registered_role::text LIMIT 1;
    SELECT x INTO source_profile FROM jsonb_array_elements(profiles) x WHERE x->>'id'=registered_profile_id LIMIT 1;
    SELECT x INTO source_block FROM jsonb_array_elements(blocks) x WHERE x->>'id'=registered_profile_id LIMIT 1;
    IF source_profile IS NULL OR source_block IS NULL THEN RAISE EXCEPTION 'Registered profile missing for %',scope; END IF;
    admin_profile_id:='access-admin-'||scope;
    SELECT coalesce(jsonb_agg(x),'[]') INTO profiles FROM jsonb_array_elements(profiles) x WHERE x->>'id'<>admin_profile_id;
    SELECT coalesce(jsonb_agg(x),'[]') INTO blocks FROM jsonb_array_elements(blocks) x WHERE x->>'id'<>admin_profile_id;
    profiles:=profiles||jsonb_build_array(source_profile||jsonb_build_object('id',admin_profile_id,'name','מנהל','updatedAt',stamp));
    blocks:=blocks||jsonb_build_array(source_block||jsonb_build_object('id',admin_profile_id,'name','מנהל','updatedAt',stamp));
    SELECT coalesce(jsonb_agg(x),'[]') INTO links FROM jsonb_array_elements(links) x WHERE x->>'roleId'<>admin_role::text;
    SELECT coalesce(jsonb_agg(x),'[]') INTO blinks FROM jsonb_array_elements(blinks) x WHERE x->>'roleId'<>admin_role::text;
    links:=links||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'roleId',admin_role,'profileId',admin_profile_id));
    blinks:=blinks||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'roleId',admin_role,'profileId',admin_profile_id));
    INSERT INTO public.site_settings(key,value) VALUES(pk,profiles),(bk,blocks),(ak,links),(ck,blinks)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  END LOOP;
  INSERT INTO public.role_content_access(role_id,include_own,include_site_library,approved_only,source_user_ids,source_tags,updated_at,updated_by)
  SELECT admin_role,a.include_own,a.include_site_library,a.approved_only,a.source_user_ids,a.source_tags,now(),auth.uid()
  FROM public.role_content_access a WHERE a.role_id=registered_role
  ON CONFLICT(role_id) DO UPDATE SET include_own=excluded.include_own,include_site_library=excluded.include_site_library,
    approved_only=excluded.approved_only,source_user_ids=excluded.source_user_ids,source_tags=excluded.source_tags,
    updated_at=now(),updated_by=auth.uid();
END $$;

DO $$ DECLARE p jsonb:=public.get_effective_content_access();
BEGIN
  IF NOT public.is_admin(auth.uid()) OR NOT coalesce((p->>'is_admin')::boolean,false) THEN
    RAISE EXCEPTION 'Administrator security marker lost; rolling back';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.site_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value) x
    JOIN public.app_roles r ON x->>'roleId'=r.id::text WHERE s.key='role_layout_profile_assignments_v1' AND r.name='admin') THEN
    RAISE EXCEPTION 'Administrator display assignment missing; rolling back';
  END IF;
END $$;
NOTIFY pgrst,'reload schema';
