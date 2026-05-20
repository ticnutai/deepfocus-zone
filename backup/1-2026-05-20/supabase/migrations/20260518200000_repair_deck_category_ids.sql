-- ============================================================
-- Repair: Link decks to matching categories when category_ids is empty
-- 
-- Problem: Migration 20260506200000_category_first_cards.sql used
-- ON CONFLICT DO NOTHING + RETURNING id, which returned NULL when a
-- category with the same name already existed — leaving category_ids=[].
--
-- Fix: For every deck with category_ids=[] whose name exactly matches
-- an existing root-level category for the same user, set category_ids
-- to point at that category.
-- ============================================================

UPDATE public.decks d
SET
  category_ids = jsonb_build_array(c.id::text),
  include_sub_categories = true
FROM public.categories c
WHERE
  d.category_ids = '[]'::jsonb
  AND d.user_id = c.user_id
  AND c.parent_id IS NULL
  AND c.name = d.name
  AND c.deleted_at IS NULL
