-- Dedicated username accounts use the existing Supabase Auth identity and roles.
-- No global email-confirmation setting is changed.
CREATE TABLE IF NOT EXISTS public.account_recovery_keys (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_recovery_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_recovery_keys FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.register_username_account(p_username text,p_password text,p_display_name text,p_recovery_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE u text:=lower(trim(p_username)); e text; id_new uuid:=gen_random_uuid();
BEGIN
  IF u IS NULL OR length(u)<2 OR length(u)>64 OR u !~ '^[[:alnum:]_.א-ת]+$' THEN RAISE EXCEPTION 'Invalid username'; END IF;
  IF length(p_password)<8 OR octet_length(p_password)>72 OR p_password !~ '[[:alpha:]א-ת]' OR p_password !~ '[0-9]' THEN RAISE EXCEPTION 'Use 8 or more characters including letters and numbers'; END IF;
  IF p_password IS NULL OR p_recovery_hash IS NULL OR p_recovery_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Password and recovery key required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('username:'||u,0));
  IF EXISTS(SELECT 1 FROM public.profiles WHERE lower(username)=u) THEN RAISE EXCEPTION 'User already registered'; END IF;
  -- The client resolves login through the existing email_for_username RPC.
  e := 'account-'||replace(id_new::text,'-','')||'@users.local';
  INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,
    confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,
    reauthentication_token,phone_change,phone_change_token)
  VALUES('00000000-0000-0000-0000-000000000000',id_new,'authenticated','authenticated',e,
    extensions.crypt(p_password,extensions.gen_salt('bf')),now(),now(),now(),
    '{"provider":"email","providers":["email"]}',jsonb_build_object('username',u,'display_name',left(coalesce(nullif(trim(p_display_name),''),u),100)),false,
    '','','','','','','','');
  INSERT INTO public.account_recovery_keys(user_id,token_hash) VALUES(id_new,p_recovery_hash);
  RETURN e;
END; $$;
REVOKE ALL ON FUNCTION public.register_username_account(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_username_account(text,text,text,text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.recover_username_account(p_username text,p_code text,p_password text,p_next_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE target uuid; supplied text;
BEGIN
  IF p_code IS NULL OR length(p_code)>100 OR p_password IS NULL OR length(p_password)<8 OR octet_length(p_password)>72
     OR p_password !~ '[[:alpha:]א-ת]' OR p_password !~ '[0-9]' OR p_next_hash IS NULL OR p_next_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid recovery details or password';
  END IF;
  supplied:=encode(extensions.digest(lower(regexp_replace(p_code,'[^a-fA-F0-9]','','g')),'sha256'),'hex');
  SELECT k.user_id INTO target FROM public.account_recovery_keys k JOIN public.profiles p ON p.id=k.user_id
    WHERE lower(p.username)=lower(trim(p_username)) AND k.token_hash=supplied FOR UPDATE OF k;
  IF target IS NULL THEN RETURN false; END IF;
  UPDATE auth.users SET encrypted_password=extensions.crypt(p_password,extensions.gen_salt('bf')),updated_at=now() WHERE id=target;
  UPDATE public.account_recovery_keys SET token_hash=p_next_hash,updated_at=now() WHERE user_id=target;
  DELETE FROM auth.sessions WHERE user_id=target;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.recover_username_account(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_username_account(text,text,text,text) TO anon,authenticated;
