-- Phase 1: Bootstrap now loads only reviewed cards (srs.repetitions > 0) — typically ~2K instead of 31K.
-- Phase 2: Client calls get_unreviewed_cards_page() in the background to backfill the rest.
--
-- Why: serializing 31K JSONB rows in one RPC call takes ~16s even with an index.
-- Loading ~2K reviewed cards takes ~1-2s. The remaining cards arrive silently in the background.

-- ── Override bootstrap to load only reviewed cards ──────────────────────────────────────────────
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

    -- Phase 1: only cards that have been reviewed at least once (have SRS state).
    -- Cards never reviewed (repetitions = 0 or srs is null) are loaded in Phase 2 via
    -- get_unreviewed_cards_page() called from the client in the background.
    'cards', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.cards c
      where c.user_id = auth.uid()
        AND c.srs IS NOT NULL
        AND (c.srs->>'repetitions')::int > 0
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

    'categories_roots', coalesce((
      select jsonb_agg(to_jsonb(ca) order by ca.sort_order nulls last, ca.created_at)
      from public.categories ca
      where ca.user_id = auth.uid() AND ca.parent_id IS NULL
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_bootstrap_snapshot() to authenticated;


-- ── Phase 2: Page-load of unreviewed cards (client calls this in background) ────────────────────
create or replace function public.get_unreviewed_cards_page(p_offset int default 0, p_limit int default 500)
returns jsonb
language sql
security definer
set search_path = public
set statement_timeout = '15s'
as $$
  select coalesce(
    jsonb_agg(to_jsonb(c)),
    '[]'::jsonb
  )
  from (
    select *
    from public.cards c
    where c.user_id = auth.uid()
      AND (c.srs IS NULL OR (c.srs->>'repetitions')::int = 0)
    order by c.created_at
    limit p_limit
    offset p_offset
  ) c;
$$;

grant execute on function public.get_unreviewed_cards_page(int, int) to authenticated;
