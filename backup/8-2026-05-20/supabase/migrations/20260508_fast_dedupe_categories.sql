-- Fast category dedupe by (user_id, parent_id, name)
-- Safe iterative convergence for tree structures.

DO $$
DECLARE
  v_iter INTEGER := 0;
  v_max_iter INTEGER := 50;
  v_dup_rows INTEGER := 0;
  v_groups INTEGER := 0;
  v_child_updates INTEGER := 0;
  v_deck_updates INTEGER := 0;
  v_deleted INTEGER := 0;
  v_total_deleted INTEGER := 0;
BEGIN
  LOOP
    v_iter := v_iter + 1;

    DROP TABLE IF EXISTS dedup_map;
    CREATE TEMP TABLE dedup_map (
      duplicate_id UUID PRIMARY KEY,
      kept_id UUID NOT NULL
    ) ON COMMIT DROP;

    -- Build map: for each duplicate sibling group keep oldest(created_at,id), drop the rest.
    WITH ranked AS (
      SELECT
        c.id,
        c.user_id,
        c.parent_id,
        c.name,
        c.created_at,
        FIRST_VALUE(c.id) OVER (
          PARTITION BY c.user_id, c.parent_id, c.name
          ORDER BY c.created_at ASC, c.id ASC
        ) AS keep_id,
        ROW_NUMBER() OVER (
          PARTITION BY c.user_id, c.parent_id, c.name
          ORDER BY c.created_at ASC, c.id ASC
        ) AS rn
      FROM public.categories c
    )
    INSERT INTO dedup_map (duplicate_id, kept_id)
    SELECT r.id, r.keep_id
    FROM ranked r
    WHERE r.rn > 1
      AND r.id <> r.keep_id;

    GET DIAGNOSTICS v_dup_rows = ROW_COUNT;

    SELECT COUNT(*)
    INTO v_groups
    FROM (
      SELECT 1
      FROM public.categories c
      GROUP BY c.user_id, c.parent_id, c.name
      HAVING COUNT(*) > 1
    ) g;

    RAISE NOTICE '[dedupe] pass=% duplicate_rows=% duplicate_groups=%', v_iter, v_dup_rows, v_groups;

    IF v_dup_rows = 0 THEN
      EXIT;
    END IF;

    IF v_iter > v_max_iter THEN
      RAISE EXCEPTION '[dedupe] did not converge after % passes', v_max_iter;
    END IF;

    -- Reparent children from dropped IDs to kept IDs.
    UPDATE public.categories c
    SET parent_id = dm.kept_id
    FROM dedup_map dm
    WHERE c.parent_id = dm.duplicate_id
      AND c.parent_id IS DISTINCT FROM dm.kept_id;

    GET DIAGNOSTICS v_child_updates = ROW_COUNT;

    -- Remap deck.category_ids (JSON array of UUID strings), keep first-seen order and dedupe.
    UPDATE public.decks d
    SET category_ids = x.new_ids
    FROM LATERAL (
      SELECT CASE
        WHEN jsonb_typeof(COALESCE(d.category_ids::jsonb, '[]'::jsonb)) = 'array' THEN
          COALESCE(
            (
              SELECT jsonb_agg(y.elem ORDER BY y.min_ord)
              FROM (
                SELECT mapped.elem, MIN(mapped.ord) AS min_ord
                FROM (
                  SELECT
                    COALESCE(dm.kept_id::text, e.elem) AS elem,
                    e.ord
                  FROM jsonb_array_elements_text(COALESCE(d.category_ids::jsonb, '[]'::jsonb)) WITH ORDINALITY AS e(elem, ord)
                  LEFT JOIN dedup_map dm
                    ON dm.duplicate_id::text = e.elem
                ) mapped
                GROUP BY mapped.elem
              ) y
            ),
            '[]'::jsonb
          )
        ELSE d.category_ids::jsonb
      END AS new_ids
    ) x
    WHERE d.category_ids::jsonb IS DISTINCT FROM x.new_ids;

    GET DIAGNOSTICS v_deck_updates = ROW_COUNT;

    -- Delete dropped duplicates (children already reparented).
    DELETE FROM public.categories c
    USING dedup_map dm
    WHERE c.id = dm.duplicate_id;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_deleted;

    RAISE NOTICE '[dedupe] pass=% child_updates=% deck_updates=% deleted=% total_deleted=%',
      v_iter, v_child_updates, v_deck_updates, v_deleted, v_total_deleted;
  END LOOP;

  -- Final validation.
  SELECT COUNT(*)
  INTO v_groups
  FROM (
    SELECT 1
    FROM public.categories c
    GROUP BY c.user_id, c.parent_id, c.name
    HAVING COUNT(*) > 1
  ) g;

  IF v_groups > 0 THEN
    RAISE EXCEPTION '[dedupe] validation failed: duplicate_groups_remaining=%', v_groups;
  END IF;

  RAISE NOTICE '[dedupe] complete: passes=% total_deleted=%', v_iter, v_total_deleted;
END $$;

ANALYZE public.categories;
ANALYZE public.decks;
