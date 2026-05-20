-- ======================================================
-- Migration: Category-first card ownership
-- Cards can now exist without a deck (category is primary owner)
-- Decks gain category_ids to define which cards they collect
-- ======================================================

-- 1. Make deck_id nullable on cards (category becomes primary owner)
ALTER TABLE public.cards
  ALTER COLUMN deck_id DROP NOT NULL;

-- Remove the old cascade-delete FK and replace with SET NULL
-- so deleting a deck doesn't delete the cards themselves
ALTER TABLE public.cards
  DROP CONSTRAINT IF EXISTS cards_deck_id_fkey;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_deck_id_fkey
  FOREIGN KEY (deck_id) REFERENCES public.decks(id) ON DELETE SET NULL;

-- 2. Add category_ids + include_sub_categories to decks
--    category_ids: array of category UUIDs whose cards this deck collects
--    include_sub_categories: per-deck default (individual overrides stored in category_ids metadata)
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS category_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS include_sub_categories boolean NOT NULL DEFAULT true;

-- 3. Migrate existing decks: create a matching category for each deck
--    and tag its cards with cat:<deck-name>
DO $$
DECLARE
  rec RECORD;
  new_cat_id uuid;
BEGIN
  FOR rec IN
    SELECT DISTINCT d.id AS deck_id, d.user_id, d.name, d.created_at
    FROM public.decks d
  LOOP
    -- Insert a root-level category named after the deck (if not already exists by name+user)
    INSERT INTO public.categories (id, user_id, name, parent_id, sort_order, created_at)
    VALUES (gen_random_uuid(), rec.user_id, rec.name, NULL, 0, rec.created_at)
    ON CONFLICT DO NOTHING
    RETURNING id INTO new_cat_id;

    IF new_cat_id IS NOT NULL THEN
      -- Tag all cards in this deck with cat:<deck-name>
      UPDATE public.cards
      SET tags = CASE
        WHEN tags @> jsonb_build_array('cat:' || rec.name) THEN tags
        ELSE tags || jsonb_build_array('cat:' || rec.name)
      END
      WHERE deck_id = rec.deck_id;

      -- Point the deck at the new category
      UPDATE public.decks
      SET category_ids = jsonb_build_array(new_cat_id::text)
      WHERE id = rec.deck_id;
    END IF;
  END LOOP;
END $$;
