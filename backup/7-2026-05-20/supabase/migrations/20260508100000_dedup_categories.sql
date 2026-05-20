-- Deduplicate categories: for each (user_id, name, parent_id) group,
-- keep the oldest row (by created_at) and delete the rest.
-- ON DELETE CASCADE handles children of deleted rows automatically.

DELETE FROM public.categories
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, name, parent_id
        ORDER BY created_at ASC
      ) AS rn
    FROM public.categories
  ) t
  WHERE rn > 1
);
