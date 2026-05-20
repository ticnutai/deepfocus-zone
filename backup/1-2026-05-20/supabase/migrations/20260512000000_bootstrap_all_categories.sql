-- Fix: bootstrap now returns ALL categories (not just roots).
--
-- WHY: The UI computes category card-counts via subtreeNames(), which recurses into
-- state.categories. If only root categories are loaded, subcategory counts are 0
-- because the children (masechets, dafim) are not in memory.
-- Previously, returning all categories caused a 17-second timeout because the query
-- also returned all 13K cards. Now that cards are split (Phase 1 returns 0 reviewed
-- cards, Phase 2 backfills silently), returning all 2755 categories is cheap.

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

    -- Phase 1: only cards the user has actually reviewed (lastReviewedAt != null).
    -- Import-created cards have lastReviewedAt = null.
    -- After any review (correct or lapse), lastReviewedAt is set to a timestamp.
    'cards', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.cards c
      where c.user_id = auth.uid()
        AND c.srs IS NOT NULL
        AND c.srs->>'lastReviewedAt' IS NOT NULL
        AND c.srs->>'lastReviewedAt' != 'null'
    ), '[]'::jsonb),

    -- Total card count so the client knows whether Phase 2 backfill is needed.
    'cards_total_count', (
      select count(*) from public.cards where user_id = auth.uid()
    ),

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

    -- ALL categories (not just roots) so subtree card-counts are correct immediately.
    -- With Phase 1 returning 0 cards, this query is cheap (~2755 rows).
    'categories_roots', coalesce((
      select jsonb_agg(to_jsonb(ca) order by ca.sort_order nulls last, ca.created_at)
      from public.categories ca
      where ca.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_bootstrap_snapshot() to authenticated;
