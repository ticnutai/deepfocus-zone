-- One visibility system for cloud UUIDs and stable bundled/offline question IDs.
ALTER TABLE public.card_visibility DROP CONSTRAINT card_visibility_card_id_fkey;
ALTER TABLE public.card_visibility ALTER COLUMN card_id TYPE text USING card_id::text;
CREATE OR REPLACE FUNCTION public.can_read_card(p_card uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(public.is_admin(auth.uid()),false) OR NOT EXISTS(SELECT 1 FROM public.card_visibility v WHERE v.card_id=p_card::text AND v.scope='admin' AND (v.target_user_id IS NULL OR v.target_user_id=auth.uid()));
$$;
DROP FUNCTION public.set_card_visibility(uuid,boolean,text,uuid);
CREATE FUNCTION public.set_card_visibility(p_card text,p_hidden boolean,p_scope text DEFAULT 'personal',p_target uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
 IF p_card IS NULL OR length(trim(p_card))=0 OR length(p_card)>256 THEN RAISE EXCEPTION 'Invalid question identifier'; END IF;
 IF p_scope='personal' THEN target:=auth.uid();
 ELSIF p_scope='admin' AND public.is_admin(auth.uid()) THEN target:=p_target;
 ELSE RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_hidden THEN
   INSERT INTO public.card_visibility(card_id,target_user_id,scope) VALUES(p_card,target,p_scope) ON CONFLICT DO NOTHING;
 ELSE
   DELETE FROM public.card_visibility WHERE card_id=p_card AND target_user_id IS NOT DISTINCT FROM target AND scope=p_scope;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_card_visibility(text,boolean,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_card_visibility(text,boolean,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
