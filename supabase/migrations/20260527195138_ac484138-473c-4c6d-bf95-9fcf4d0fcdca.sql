
-- Default site_settings entry for guest source (disabled by default)
INSERT INTO public.site_settings (key, value)
VALUES ('guest_source', jsonb_build_object('enabled', false, 'user_id', null))
ON CONFLICT (key) DO NOTHING;

-- Allow admins to update this key (existing site_settings policies already allow admin all-access)

-- Helper: returns source uid when enabled, else NULL
CREATE OR REPLACE FUNCTION public.get_guest_source_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE((value->>'enabled')::boolean, false) = true
      AND NULLIF(value->>'user_id','') IS NOT NULL
    THEN (value->>'user_id')::uuid
    ELSE NULL
  END
  FROM public.site_settings
  WHERE key = 'guest_source'
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_guest_source_user_id() TO anon, authenticated;

-- Guest bootstrap snapshot (mirrors get_bootstrap_snapshot but for the configured source user)
CREATE OR REPLACE FUNCTION public.get_guest_bootstrap_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO '30s'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := public.get_guest_source_user_id();
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
GRANT EXECUTE ON FUNCTION public.get_guest_bootstrap_snapshot() TO anon, authenticated;

-- Guest lazy category children
CREATE OR REPLACE FUNCTION public.get_guest_category_children(p_parent_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, parent_id uuid, color text, created_at timestamptz, sort_order integer, has_children boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (SELECT public.get_guest_source_user_id() AS uid)
  SELECT
    c.id, c.name, c.parent_id, c.color, c.created_at, c.sort_order,
    EXISTS (
      SELECT 1 FROM public.categories ch
      WHERE ch.user_id = c.user_id AND ch.parent_id = c.id AND ch.deleted_at IS NULL
    ) AS has_children
  FROM public.categories c, src
  WHERE src.uid IS NOT NULL
    AND c.user_id = src.uid
    AND c.deleted_at IS NULL
    AND (
      (p_parent_id IS NULL AND c.parent_id IS NULL)
      OR c.parent_id = p_parent_id
    )
  ORDER BY c.sort_order NULLS LAST, c.created_at;
$$;
GRANT EXECUTE ON FUNCTION public.get_guest_category_children(uuid) TO anon, authenticated;

-- Guest unreviewed cards page (phase 2 backfill)
CREATE OR REPLACE FUNCTION public.get_guest_unreviewed_cards_page(p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO '60s'
AS $$
  WITH src AS (SELECT public.get_guest_source_user_id() AS uid)
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
  FROM (
    SELECT c.*
    FROM public.cards c, src
    WHERE src.uid IS NOT NULL
      AND c.user_id = src.uid
      AND (
        c.srs IS NULL
        OR c.srs->>'lastReviewedAt' IS NULL
        OR c.srs->>'lastReviewedAt' = 'null'
      )
    ORDER BY c.created_at
    LIMIT p_limit OFFSET p_offset
  ) c;
$$;
GRANT EXECUTE ON FUNCTION public.get_guest_unreviewed_cards_page(integer, integer) TO anon, authenticated;

-- Card->categories mapping for guest (cards may live under multiple categories)
CREATE OR REPLACE FUNCTION public.get_guest_card_categories()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (SELECT public.get_guest_source_user_id() AS uid)
  SELECT coalesce(jsonb_agg(to_jsonb(cc)), '[]'::jsonb)
  FROM public.card_categories cc, src
  WHERE src.uid IS NOT NULL AND cc.user_id = src.uid;
$$;
GRANT EXECUTE ON FUNCTION public.get_guest_card_categories() TO anon, authenticated;
