DROP INDEX IF EXISTS public.categories_unique_name_per_parent;
CREATE UNIQUE INDEX categories_unique_name_per_parent
  ON public.categories (user_id, TRIM(BOTH FROM name), COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;