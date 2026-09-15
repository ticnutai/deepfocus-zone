DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='role_baseline_enabled') THEN RAISE EXCEPTION 'Already applied; stop'; END IF;
 IF position('is_admin' in pg_get_functiondef('public.exec_sql(text)'::regprocedure))=0 THEN RAISE EXCEPTION 'Missing administrator guard'; END IF;
END $$;
