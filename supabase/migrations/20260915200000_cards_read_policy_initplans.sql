-- Preserve authorization semantics while evaluating user-only checks once per
-- statement rather than for every card. Content visibility remains restrictive.
ALTER POLICY cards_all_own ON public.cards
 USING (user_id = (SELECT auth.uid()));
ALTER POLICY cards_admin_select_all ON public.cards
 USING ((SELECT public.is_admin(auth.uid())));
ALTER POLICY access_role_view ON public.cards
 USING ((SELECT public.has_permission(auth.uid(), 'cards'::public.permission_module, 'view'::public.permission_action)));
NOTIFY pgrst, 'reload schema';
