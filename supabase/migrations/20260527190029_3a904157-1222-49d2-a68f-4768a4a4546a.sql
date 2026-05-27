-- Soft-delete the duplicate "תלמוד בבלי" root tree (and all descendants) for the single
-- affected user. Cards remain intact because none are linked via card_categories to this tree.
-- Tombstones will sync down to clients via get_bootstrap_snapshot.categories_tombstones.
WITH RECURSIVE tree AS (
  SELECT id FROM public.categories
  WHERE user_id = 'e71f9004-612c-49b0-b147-00514a2338ef'
    AND name = 'תלמוד בבלי'
    AND parent_id IS NULL
    AND deleted_at IS NULL
  UNION ALL
  SELECT c.id FROM public.categories c
  JOIN tree t ON c.parent_id = t.id
  WHERE c.deleted_at IS NULL
)
UPDATE public.categories
SET deleted_at = now(), updated_at = now()
WHERE id IN (SELECT id FROM tree);