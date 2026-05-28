-- Per-guest-profile source RPCs. Accept an explicit source user id and fall back
-- to the global guest_source setting when null.

CREATE OR REPLACE FUNCTION public.get_guest_bootstrap_snapshot_for(p_source_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := COALESCE(p_source_user_id, public.get_guest_source_user_id());
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'decks', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at)
      from public.decks d
      where d.user_id = v_uid and d.deleted_at is null
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.cards c
      where c.user_id = v_uid
        and c.srs IS NOT NULL
        and c.srs->>'lastReviewedAt' IS NOT NULL
        and c.srs->>'lastReviewedAt' != 'null'
    ), '[]'::jsonb),
    'cards_total_count', (
      select count(*) from public.cards where user_id = v_uid
    ),
    'review_logs', '[]'::jsonb,
    'goals', '[]'::jsonb,
    'shas_legacy', null,
    'day_notes', '[]'::jsonb,
    'user_settings', null,
    'card_decks', coalesce((
      select jsonb_agg(to_jsonb(cd) order by cd.sort_order)
      from public.card_decks cd
      where cd.user_id = v_uid
    ), '[]'::jsonb),
    'shas_reviews', '[]'::jsonb,
    'learning_sessions', '[]'::jsonb,
    'categories_roots', coalesce((
      select jsonb_agg(to_jsonb(ca) order by ca.sort_order nulls last, ca.created_at)
      from public.categories ca
      where ca.user_id = v_uid and ca.deleted_at is null
    ), '[]'::jsonb),
    'categories_tombstones', '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_guest_category_children_for(p_source_user_id uuid DEFAULT NULL, p_parent_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, parent_id uuid, color text, created_at timestamp with time zone, sort_order integer, has_children boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := COALESCE(p_source_user_id, public.get_guest_source_user_id());
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.parent_id, c.color, c.created_at, c.sort_order,
      EXISTS (
        SELECT 1 FROM public.categories ch
        WHERE ch.user_id = c.user_id AND ch.parent_id = c.id AND ch.deleted_at IS NULL
      )
    FROM public.categories c
    WHERE c.user_id = v_uid
      AND c.deleted_at IS NULL
      AND (
        (p_parent_id IS NULL AND c.parent_id IS NULL)
        OR c.parent_id = p_parent_id
      )
    ORDER BY c.sort_order NULLS LAST, c.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_guest_unreviewed_cards_page_for(p_source_user_id uuid DEFAULT NULL, p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := COALESCE(p_source_user_id, public.get_guest_source_user_id());
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(c))
    FROM (
      SELECT c.*
      FROM public.cards c
      WHERE c.user_id = v_uid
        AND (
          c.srs IS NULL
          OR c.srs->>'lastReviewedAt' IS NULL
          OR c.srs->>'lastReviewedAt' = 'null'
        )
      ORDER BY c.created_at
      LIMIT p_limit OFFSET p_offset
    ) c
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_guest_card_categories_for(p_source_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := COALESCE(p_source_user_id, public.get_guest_source_user_id());
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(cc))
    FROM public.card_categories cc
    WHERE cc.user_id = v_uid
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_bootstrap_snapshot_for(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guest_category_children_for(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guest_unreviewed_cards_page_for(uuid, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guest_card_categories_for(uuid) TO anon, authenticated;