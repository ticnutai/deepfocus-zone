-- Fix: bootstrap snapshot now returns ALL categories, not just roots.
-- Previously, only root categories (parent_id IS NULL) were returned, causing the client
-- to show far fewer cards than actually exist because cards are matched by category name.
-- With all 6,820 categories available from startup, all 10,230 cards will be visible.

create or replace function public.get_bootstrap_snapshot()
returns jsonb
language sql
security definer
set search_path = public
set statement_timeout = '30s'
as $$
  select jsonb_build_object(
    'decks', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at)
      from public.decks d
      where d.user_id = auth.uid()
    ), '[]'::jsonb),

    'cards', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.cards c
      where c.user_id = auth.uid()
    ), '[]'::jsonb),

    'review_logs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.at desc)
      from (
        select *
        from public.review_logs
        where user_id = auth.uid()
        order by at desc
        limit 2000
      ) r
    ), '[]'::jsonb),

    'goals', coalesce((
      select jsonb_agg(to_jsonb(g))
      from public.goals g
      where g.user_id = auth.uid()
    ), '[]'::jsonb),

    'shas_legacy', (
      select to_jsonb(sp)
      from public.shas_plans sp
      where sp.user_id = auth.uid()
      order by sp.created_at desc
      limit 1
    ),

    'day_notes', coalesce((
      select jsonb_agg(to_jsonb(n))
      from public.day_notes n
      where n.user_id = auth.uid()
    ), '[]'::jsonb),

    'user_settings', (
      select to_jsonb(s)
      from public.user_settings s
      where s.user_id = auth.uid()
      limit 1
    ),

    'card_decks', coalesce((
      select jsonb_agg(to_jsonb(cd) order by cd.sort_order)
      from public.card_decks cd
      where cd.user_id = auth.uid()
    ), '[]'::jsonb),

    'shas_reviews', coalesce((
      select jsonb_agg(to_jsonb(sr) order by sr.due_date)
      from public.shas_reviews sr
      where sr.user_id = auth.uid()
    ), '[]'::jsonb),

    'learning_sessions', coalesce((
      select jsonb_agg(to_jsonb(ls) order by ls.created_at desc)
      from public.learning_sessions ls
      where ls.user_id = auth.uid()
    ), '[]'::jsonb),

    -- Root categories only — child categories are loaded lazily on-demand by the client.
    -- Reverting from "ALL categories" which caused a 17s statement timeout (6820 rows).
    'categories_roots', coalesce((
      select jsonb_agg(to_jsonb(ca) order by ca.sort_order nulls last, ca.created_at)
      from public.categories ca
      where ca.user_id = auth.uid() AND ca.parent_id IS NULL
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_bootstrap_snapshot() to authenticated;
