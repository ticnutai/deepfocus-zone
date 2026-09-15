-- Exercise real cloud functions in a rolled-back subtransaction, never changing real users.
DO $$ DECLARE
 admin_id uuid:=auth.uid(); fixture uuid:=gen_random_uuid(); narrow uuid:=gen_random_uuid(); wide uuid:=gen_random_uuid(); baseline uuid; blocked boolean;
BEGIN
 IF NOT public.is_admin(admin_id) THEN RAISE EXCEPTION 'Administrator required'; END IF;
 SELECT id INTO baseline FROM public.app_roles WHERE access_kind='registered';
 BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data,is_anonymous) VALUES(fixture,'qa-role-'||fixture||'@example.invalid','{}',false);
  INSERT INTO public.profiles(id,email) VALUES(fixture,'qa-role-'||fixture||'@example.invalid') ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.app_roles(id,name) VALUES(narrow,'qa-narrow-'||fixture),(wide,'qa-wide-'||fixture);
  INSERT INTO public.role_permissions(role_id,module,action,allowed) VALUES
   (narrow,'cards','view',true),(narrow,'cards','create',false),(wide,'cards','view',true),(wide,'cards','create',true);
  INSERT INTO public.user_roles(user_id,role_id) VALUES(fixture,narrow);
  IF NOT EXISTS(SELECT 1 FROM public.effective_access_role_ids(fixture) r WHERE r=baseline) THEN RAISE EXCEPTION 'Existing additive default changed'; END IF;
  PERFORM public.admin_replace_user_role(fixture,narrow);
  IF EXISTS(SELECT 1 FROM public.effective_access_role_ids(fixture) r WHERE r=baseline) THEN RAISE EXCEPTION 'Baseline survived replacement'; END IF;
  IF NOT public.has_permission(fixture,'cards','view') OR public.has_permission(fixture,'cards','create') THEN RAISE EXCEPTION 'Restricted replacement failed'; END IF;
  INSERT INTO public.user_roles(user_id,role_id) VALUES(fixture,wide);
  IF NOT public.has_permission(fixture,'cards','create') THEN RAISE EXCEPTION 'Add role failed'; END IF;
  INSERT INTO public.user_permission_overrides(user_id,module,action,allowed) VALUES(fixture,'cards','create',false);
  IF public.has_permission(fixture,'cards','create') THEN RAISE EXCEPTION 'Personal denial ignored'; END IF;
  DELETE FROM public.user_permission_overrides WHERE user_id=fixture;
  PERFORM public.admin_replace_user_role(fixture,wide);
  IF NOT public.has_permission(fixture,'cards','create') THEN RAISE EXCEPTION 'Privilege increase failed'; END IF;
  PERFORM public.admin_replace_user_role(fixture,narrow);
  IF public.has_permission(fixture,'cards','create') THEN RAISE EXCEPTION 'Privilege reduction failed'; END IF;
  INSERT INTO public.role_content_access(role_id,include_own,include_site_library,approved_only,source_user_ids,source_tags)
   VALUES(narrow,true,false,true,'{}',ARRAY['qa-only']) ON CONFLICT(role_id) DO UPDATE SET source_tags=ARRAY['qa-only'];
  PERFORM set_config('request.jwt.claim.sub',fixture::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',fixture,'role','authenticated')::text,true);
  IF public.get_effective_question_source_tags() IS DISTINCT FROM ARRAY['qa-only'] THEN RAISE EXCEPTION 'Source baseline leaked'; END IF;
  IF public.get_effective_content_access()->'source_tags' IS DISTINCT FROM '["qa-only"]'::jsonb THEN RAISE EXCEPTION 'Content resolver mismatch'; END IF;
  blocked:=false;
  BEGIN PERFORM public.admin_replace_user_role(fixture,wide); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Non-admin changed role'; END IF;
  blocked:=false;
  BEGIN UPDATE public.profiles SET role_baseline_enabled=true WHERE id=fixture; EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'User restored own privileges'; END IF;
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
  PERFORM public.admin_replace_user_role(fixture,baseline);
  IF NOT EXISTS(SELECT 1 FROM public.effective_access_role_ids(fixture) r WHERE r=baseline) THEN RAISE EXCEPTION 'Return to default failed'; END IF;
  RAISE EXCEPTION 'Rollback QA fixtures' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=fixture) OR EXISTS(SELECT 1 FROM public.app_roles WHERE id IN(narrow,wide)) THEN RAISE EXCEPTION 'Fixture cleanup failed'; END IF;
END $$;
