-- Keep the existing owner whitelist, and additionally require a CURRENT
-- administrator role. A demoted owner must not retain a privileged SQL route.
DO $$
DECLARE original text; definition text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.access_role_repair_backups WHERE id='20260908050000') THEN RETURN; END IF;
  original:=pg_get_functiondef('public.exec_sql(text)'::regprocedure);
  INSERT INTO public.access_role_repair_backups(id,snapshot) VALUES ('20260908050000',jsonb_build_object('exec_sql',original));
  definition:=regexp_replace(original,'\mBEGIN\M',E'BEGIN\n  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION ''Current administrator role required''; END IF;','i');
  EXECUTE definition;
END $$;
