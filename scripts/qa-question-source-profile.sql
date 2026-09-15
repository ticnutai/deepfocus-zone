-- All temporary records are rolled back inside the nested exception block.
DO $$ DECLARE rid uuid; pid text := 'qa-source-'||gen_random_uuid(); observed text[]; version bigint;
BEGIN
 IF public.question_source_ids('["source:client:desktop"]'::jsonb) <> ARRAY['unattributed'] THEN RAISE EXCEPTION 'Unknown provenance mismatch'; END IF;
 IF NOT (public.question_source_ids('["source:ai","source:shemesh"]'::jsonb) @> ARRAY['ai','shemesh']) THEN RAISE EXCEPTION 'Multi provenance mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='cards' AND policyname='cards_question_source_boundary') THEN RAISE EXCEPTION 'Boundary missing'; END IF;
 BEGIN
  INSERT INTO public.app_roles(name,description) VALUES(pid,'Temporary QA rollback') RETURNING id INTO rid;
  PERFORM public.admin_save_access_profile(p_scope=>'desktop',p_layout=>jsonb_build_object('id',pid,'name',pid,'contentAccess',jsonb_build_object('includeOwn',true,'includeSiteLibrary',true,'approvedOnly',true,'sourceUserIds','[]'::jsonb,'sourceTags','["ai","shemesh"]'::jsonb)),p_block=>jsonb_build_object('id',pid,'name',pid,'blocklist',jsonb_build_object('sections','[]'::jsonb,'widgets','{}'::jsonb)),p_role_ids=>ARRAY[rid],p_permissions=>'[]'::jsonb,p_expected_permissions=>'{}'::jsonb,p_expected_updated_at=>NULL);
  SELECT source_tags INTO observed FROM public.role_content_access WHERE role_id=rid;
  IF observed IS NULL OR NOT(observed @> ARRAY['ai','shemesh']) THEN RAISE EXCEPTION 'Save/reload failed'; END IF;
  SELECT (x->>'updatedAt')::bigint INTO version FROM public.site_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value) x WHERE s.key='role_layout_profiles_v1' AND x->>'id'=pid;
  PERFORM public.admin_save_access_profile(p_scope=>'desktop',p_layout=>jsonb_build_object('id',pid,'name',pid,'contentAccess',jsonb_build_object('includeOwn',true,'includeSiteLibrary',true,'approvedOnly',true,'sourceUserIds','[]'::jsonb,'sourceTags','[]'::jsonb)),p_block=>jsonb_build_object('id',pid,'name',pid,'blocklist',jsonb_build_object('sections','[]'::jsonb,'widgets','{}'::jsonb)),p_role_ids=>ARRAY[rid],p_permissions=>'[]'::jsonb,p_expected_permissions=>'{}'::jsonb,p_expected_updated_at=>version);
  SELECT source_tags INTO observed FROM public.role_content_access WHERE role_id=rid;
  IF observed IS NULL OR cardinality(observed)<>0 THEN RAISE EXCEPTION 'Clear selection not persisted'; END IF;
  RAISE EXCEPTION 'QA_ROLLBACK_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'QA_ROLLBACK_SUCCESS' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.app_roles WHERE name=pid) THEN RAISE EXCEPTION 'QA cleanup failed'; END IF;
END; $$;
