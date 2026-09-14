CREATE TABLE public.card_visibility (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
 target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 scope text NOT NULL CHECK(scope IN ('personal','admin')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(scope <> 'personal' OR target_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX card_visibility_target ON public.card_visibility(card_id,coalesce(target_user_id,'00000000-0000-0000-0000-000000000000'::uuid),scope);
ALTER TABLE public.card_visibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_visibility FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.card_visibility TO authenticated,anon;
CREATE POLICY visibility_read ON public.card_visibility FOR SELECT USING(public.is_admin(auth.uid()) OR target_user_id=auth.uid() OR target_user_id IS NULL);

CREATE FUNCTION public.can_read_card(p_card uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(public.is_admin(auth.uid()),false) OR NOT EXISTS(SELECT 1 FROM public.card_visibility v WHERE v.card_id=p_card AND v.scope='admin' AND (v.target_user_id IS NULL OR v.target_user_id=auth.uid()));
$$;
CREATE POLICY cards_visibility_boundary ON public.cards AS RESTRICTIVE FOR SELECT USING(public.can_read_card(id));

CREATE FUNCTION public.set_card_visibility(p_card uuid,p_hidden boolean,p_scope text DEFAULT 'personal',p_target uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
 IF p_scope='personal' THEN target:=auth.uid();
 ELSIF p_scope='admin' AND public.is_admin(auth.uid()) THEN target:=p_target;
 ELSE RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_hidden THEN
   IF NOT EXISTS(SELECT 1 FROM public.cards WHERE id=p_card) THEN RAISE EXCEPTION 'Question not found'; END IF;
   INSERT INTO public.card_visibility(card_id,target_user_id,scope) VALUES(p_card,target,p_scope) ON CONFLICT DO NOTHING;
 ELSE
   DELETE FROM public.card_visibility WHERE card_id=p_card AND target_user_id IS NOT DISTINCT FROM target AND scope=p_scope;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_card_visibility(uuid,boolean,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_card_visibility(uuid,boolean,text,uuid) TO authenticated;

-- Existing source RPCs bypass RLS; extend those same queries rather than adding a second feed.
DO $$ DECLARE name text; original text; changed text;
BEGIN
 FOREACH name IN ARRAY ARRAY['get_content_overlay_snapshot()','get_content_unreviewed_cards_page(integer,integer)','get_content_card_categories()'] LOOP
   original:=pg_get_functiondef(('public.'||name)::regprocedure);
   changed:=replace(original,'c.deleted_at IS NULL','c.deleted_at IS NULL AND public.can_read_card(c.id)');
   changed:=replace(changed,'c.deleted_at is null','c.deleted_at is null and public.can_read_card(c.id)');
   IF changed=original THEN RAISE EXCEPTION 'Expected query boundary missing: %',name; END IF;
   EXECUTE changed;
 END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
