-- GoTrue scans these token fields as non-null strings. The legacy admin
-- creator omitted them, producing accounts that could not sign in.
DO $$
DECLARE definition text; original text;
BEGIN
  original:=pg_get_functiondef('public.admin_create_user(text,text,text,text,text,text)'::regprocedure);
  definition:=replace(original,'is_super_admin, confirmation_token, recovery_token',
    'is_super_admin, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, reauthentication_token, phone_change, phone_change_token');
  definition:=replace(definition,$s$false, '', ''$s$,$s$false, '', '', '', '', '', '', '', ''$s$);
  IF definition=original THEN RAISE EXCEPTION 'Unexpected account creator definition; inspect before modifying'; END IF;
  INSERT INTO public.access_role_repair_backups(id,snapshot) VALUES ('20260908020000',jsonb_build_object('admin_create_user',original));
  EXECUTE definition;
END $$;
