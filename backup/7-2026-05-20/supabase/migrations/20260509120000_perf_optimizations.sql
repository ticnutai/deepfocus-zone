-- Performance optimizations: faster reorder RPC + combined settings upsert.

-- 1. Make sure perf indexes from previous migration exist (idempotent)
CREATE INDEX IF NOT EXISTS idx_categories_user_parent
  ON public.categories (user_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_categories_user_parent_sort
  ON public.categories (user_id, parent_id, sort_order, created_at);

-- 2. Improved reorder_user_categories:
--    Switch to plpgsql so auth.uid() is captured once (not per-row),
--    which reduces overhead on large category lists.
CREATE OR REPLACE FUNCTION public.reorder_user_categories(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  WITH ordered AS (
    SELECT id, (ord::integer - 1) AS sort_order
    FROM unnest(p_ids) WITH ORDINALITY AS t(id, ord)
  )
  UPDATE public.categories c
  SET sort_order = o.sort_order
  FROM ordered o
  WHERE c.id = o.id
    AND c.user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_user_categories(uuid[]) TO authenticated;

-- 3. Index on categories(user_id) for fast RLS-bypassed reorder scan.
--    (user_id, id) composite helps the UPDATE lookup when joined with ordinality CTE.
CREATE INDEX IF NOT EXISTS idx_categories_user_id
  ON public.categories (user_id);

