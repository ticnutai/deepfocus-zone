-- Compute the current user's admin exclusions once per query, not once per card.
CREATE FUNCTION public.hidden_by_admin_card_ids() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN coalesce(public.is_admin(auth.uid()),false) THEN ARRAY[]::text[]
 ELSE coalesce((SELECT array_agg(card_id) FROM public.card_visibility WHERE scope='admin' AND (target_user_id IS NULL OR target_user_id=auth.uid())), ARRAY[]::text[]) END;
$$;
ALTER POLICY cards_visibility_boundary ON public.cards USING(NOT(id::text = ANY((SELECT public.hidden_by_admin_card_ids())::text[])));
DO $$ DECLARE name text; original text; changed text;
BEGIN
 FOREACH name IN ARRAY ARRAY['get_content_overlay_snapshot()','get_content_unreviewed_cards_page(integer,integer)','get_content_card_categories()'] LOOP
   original:=pg_get_functiondef(('public.'||name)::regprocedure);
   changed:=replace(original,'public.can_read_card(c.id)','NOT(c.id::text = ANY((SELECT public.hidden_by_admin_card_ids())::text[]))');
   IF changed=original THEN RAISE EXCEPTION 'Expected visibility boundary missing: %',name; END IF;
   EXECUTE changed;
 END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
