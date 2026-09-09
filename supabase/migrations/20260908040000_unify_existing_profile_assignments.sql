-- Archive legacy drafts and combine the active layout + visibility for each
-- real role. In particular, mobile registered users previously had two
-- different profile IDs for layout and visibility.
DO $$
DECLARE scope text; suffix text; lp jsonb; bp jsonb; la jsonb; ba jsonb;
  next_lp jsonb; next_bp jsonb; next_links jsonb; r record; layout jsonb; block jsonb;
  lid text; bid text; pid text; actions jsonb; stamp bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('access-profile-writer'));
  IF EXISTS (SELECT 1 FROM public.access_role_repair_backups WHERE id='20260908040000') THEN RETURN; END IF;
  INSERT INTO public.access_role_repair_backups(id,snapshot)
    SELECT '20260908040000',jsonb_build_object('settings',jsonb_agg(to_jsonb(s))) FROM public.site_settings s
    WHERE key LIKE 'role_layout_%' OR key LIKE 'feature_blocklist_%';
  FOREACH scope IN ARRAY ARRAY['desktop','mobile'] LOOP
    suffix:=CASE WHEN scope='mobile' THEN '_mobile_v1' ELSE '_v1' END;
    SELECT value INTO lp FROM public.site_settings WHERE key='role_layout_profiles'||suffix;
    SELECT value INTO bp FROM public.site_settings WHERE key='feature_blocklist_profiles'||suffix;
    SELECT value INTO la FROM public.site_settings WHERE key='role_layout_profile_assignments'||suffix;
    SELECT value INTO ba FROM public.site_settings WHERE key='feature_blocklist_role_assignments'||suffix;
    next_lp:='[]'; next_bp:='[]'; next_links:='[]';
    FOR r IN SELECT * FROM public.app_roles WHERE name<>'admin' ORDER BY access_kind NULLS LAST,id LOOP
      SELECT x->>'profileId' INTO lid FROM jsonb_array_elements(COALESCE(la,'[]')) WITH ORDINALITY a(x,n) WHERE x->>'roleId'=r.id::text ORDER BY n DESC LIMIT 1;
      SELECT x->>'profileId' INTO bid FROM jsonb_array_elements(COALESCE(ba,'[]')) WITH ORDINALITY a(x,n) WHERE x->>'roleId'=r.id::text ORDER BY n DESC LIMIT 1;
      IF lid IS NULL AND bid IS NULL THEN CONTINUE; END IF;
      SELECT x INTO layout FROM jsonb_array_elements(COALESCE(lp,'[]')) x WHERE x->>'id'=lid LIMIT 1;
      SELECT x INTO block FROM jsonb_array_elements(COALESCE(bp,'[]')) x WHERE x->>'id'=bid LIMIT 1;
      IF layout IS NULL AND block IS NULL THEN RAISE EXCEPTION 'Assigned profile is missing; abort archive'; END IF;
      SELECT COALESCE(jsonb_object_agg(module,perms),'{}') INTO actions FROM
        (SELECT module,jsonb_object_agg(action,allowed) perms FROM public.role_permissions WHERE role_id=r.id GROUP BY module) p;
      pid:='access-'||r.id::text; stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
      next_lp:=next_lp||jsonb_build_array(COALESCE(layout,jsonb_build_object('widgetLayout','{}'::jsonb,'sidebarConfig','[]'::jsonb,'categoryTemplate','[]'::jsonb))||jsonb_build_object('id',pid,'name',r.name,'actionPermissions',actions,'updatedAt',stamp));
      next_bp:=next_bp||jsonb_build_array(COALESCE(block,jsonb_build_object('blocklist',jsonb_build_object('sections','[]'::jsonb,'widgets','{}'::jsonb)))||jsonb_build_object('id',pid,'name',r.name,'updatedAt',stamp));
      next_links:=next_links||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'roleId',r.id,'profileId',pid));
    END LOOP;
    INSERT INTO public.site_settings(key,value) VALUES
      ('role_layout_profiles'||suffix,next_lp),('feature_blocklist_profiles'||suffix,next_bp),
      ('role_layout_profile_assignments'||suffix,next_links),('feature_blocklist_role_assignments'||suffix,next_links)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
  END LOOP;
END $$;
