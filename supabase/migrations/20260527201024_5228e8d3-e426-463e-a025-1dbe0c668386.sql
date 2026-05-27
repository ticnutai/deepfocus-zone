
-- New site-setting key used as on/off toggle for authenticated overlay.
-- (No schema change for site_settings — it already exists as key/value jsonb.)

-- 1) Snapshot for authenticated users
CREATE OR REPLACE FUNCTION public.get_source_overlay_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  v_uid uuid;
  v_enabled boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE((value->>'enabled')::boolean, false)
    INTO v_enabled
  FROM public.site_settings
  WHERE key = 'source_overlay_for_users'
  LIMIT 1;
  IF NOT COALESCE(v_enabled, false) THEN RETURN NULL; END IF;

  v_uid := public.get_guest_source_user_id();
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  IF v_uid = auth.uid() THEN RETURN NULL; END IF; -- the source user himself gets nothing extra

  RETURN jsonb_build_object(
    'source_user_id', v_uid,
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
    'card_decks', coalesce((
      select jsonb_agg(to_jsonb(cd) order by cd.sort_order)
      from public.card_decks cd
      where cd.user_id = v_uid
    ), '[]'::jsonb),
    'categories_roots', coalesce((
      select jsonb_agg(to_jsonb(ca) order by ca.sort_order nulls last, ca.created_at)
      from public.categories ca
      where ca.user_id = v_uid and ca.deleted_at is null
    ), '[]'::jsonb)
  );
END;
$$;

-- 2) Category children (lazy load)
CREATE OR REPLACE FUNCTION public.get_source_category_children(p_parent_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, parent_id uuid, color text, created_at timestamptz, sort_order integer, has_children boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_enabled boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  SELECT COALESCE((value->>'enabled')::boolean, false)
    INTO v_enabled
  FROM public.site_settings WHERE key = 'source_overlay_for_users' LIMIT 1;
  IF NOT COALESCE(v_enabled, false) THEN RETURN; END IF;

  v_uid := public.get_guest_source_user_id();
  IF v_uid IS NULL OR v_uid = auth.uid() THEN RETURN; END IF;

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

-- 3) Unreviewed cards page
CREATE OR REPLACE FUNCTION public.get_source_unreviewed_cards_page(p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  v_uid uuid;
  v_enabled boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE((value->>'enabled')::boolean, false)
    INTO v_enabled
  FROM public.site_settings WHERE key = 'source_overlay_for_users' LIMIT 1;
  IF NOT COALESCE(v_enabled, false) THEN RETURN '[]'::jsonb; END IF;

  v_uid := public.get_guest_source_user_id();
  IF v_uid IS NULL OR v_uid = auth.uid() THEN RETURN '[]'::jsonb; END IF;

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

-- 4) card_categories join rows
CREATE OR REPLACE FUNCTION public.get_source_card_categories()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_enabled boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE((value->>'enabled')::boolean, false)
    INTO v_enabled
  FROM public.site_settings WHERE key = 'source_overlay_for_users' LIMIT 1;
  IF NOT COALESCE(v_enabled, false) THEN RETURN '[]'::jsonb; END IF;

  v_uid := public.get_guest_source_user_id();
  IF v_uid IS NULL OR v_uid = auth.uid() THEN RETURN '[]'::jsonb; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(cc))
    FROM public.card_categories cc
    WHERE cc.user_id = v_uid
  ), '[]'::jsonb);
END;
$$;

-- Permissions: authenticated only
REVOKE ALL ON FUNCTION public.get_source_overlay_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_source_category_children(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_source_unreviewed_cards_page(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_source_card_categories() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_source_overlay_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_source_category_children(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_source_unreviewed_cards_page(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_source_card_categories() TO authenticated;
