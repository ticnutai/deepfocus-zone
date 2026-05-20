-- Add tombstone column for soft deletes
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Index to quickly filter active (non-deleted) categories
CREATE INDEX IF NOT EXISTS categories_deleted_at_idx
  ON public.categories (user_id, deleted_at);

-- Update get_category_children to skip tombstoned rows
CREATE OR REPLACE FUNCTION public.get_category_children(p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, parent_id uuid, color text, created_at timestamp with time zone, sort_order integer, has_children boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id,
    c.name,
    c.parent_id,
    c.color,
    c.created_at,
    c.sort_order,
    exists (
      select 1
      from public.categories ch
      where ch.user_id = c.user_id
        and ch.parent_id = c.id
        and ch.deleted_at is null
    ) as has_children
  from public.categories c
  where c.user_id = auth.uid()
    and c.deleted_at is null
    and (
      (p_parent_id is null and c.parent_id is null)
      or c.parent_id = p_parent_id
    )
  order by c.sort_order nulls last, c.created_at;
$function$;

-- Update bootstrap snapshot to skip tombstoned categories
CREATE OR REPLACE FUNCTION public.get_bootstrap_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
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
        AND c.srs IS NOT NULL
        AND c.srs->>'lastReviewedAt' IS NOT NULL
        AND c.srs->>'lastReviewedAt' != 'null'
    ), '[]'::jsonb),

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

    -- Categories: include deleted_at so client can filter; only return non-deleted
    'categories_roots', coalesce((
      select jsonb_agg(to_jsonb(ca) order by ca.sort_order nulls last, ca.created_at)
      from public.categories ca
      where ca.user_id = auth.uid()
        and ca.deleted_at is null
    ), '[]'::jsonb),

    -- Tombstones: list of recently-deleted category ids so clients can drop them locally
    'categories_tombstones', coalesce((
      select jsonb_agg(jsonb_build_object('id', ca.id, 'deleted_at', ca.deleted_at))
      from public.categories ca
      where ca.user_id = auth.uid()
        and ca.deleted_at is not null
    ), '[]'::jsonb)
  );
$function$;