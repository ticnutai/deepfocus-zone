-- ================================================================
-- Deduplicate cards & categories + add UNIQUE indexes to prevent future duplicates
-- ================================================================
-- Cards: 17,247 duplicates found (import scripts ran multiple times)
-- Categories: 0 duplicates currently, but adding constraint anyway
-- ================================================================

-- Step 1: Clean up card_decks rows pointing to duplicate cards
--   (card_decks has no FK cascade on card_id, so must clean manually)
DELETE FROM public.card_decks
WHERE card_id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id,
                     COALESCE(deck_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     md5(question)
        ORDER BY created_at ASC
      ) AS rn
    FROM public.cards
  ) ranked
  WHERE rn > 1
);

-- Step 2: Delete duplicate cards (keep oldest per user+deck+question group)
--   review_logs.card_id has ON DELETE CASCADE so those clean up automatically
DELETE FROM public.cards
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id,
                     COALESCE(deck_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     md5(question)
        ORDER BY created_at ASC
      ) AS rn
    FROM public.cards
  ) ranked
  WHERE rn > 1
);

-- Step 3: Delete duplicate categories (keep oldest per user+name+parent group)
DELETE FROM public.categories
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id,
                     name,
                     COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY created_at ASC
      ) AS rn
    FROM public.categories
  ) ranked
  WHERE rn > 1
);

-- Step 4: UNIQUE index on cards — prevents importing the same card twice
--   Uses md5(question) to handle long text (B-tree index size limit)
--   COALESCE(deck_id) makes NULL-safe (cards without a deck still deduplicate per user)
CREATE UNIQUE INDEX IF NOT EXISTS cards_unique_question_per_deck
ON public.cards (
  user_id,
  COALESCE(deck_id, '00000000-0000-0000-0000-000000000000'::uuid),
  md5(question)
);

-- Step 5: UNIQUE index on categories — prevents duplicate subcategories at any level
--   COALESCE(parent_id) makes NULL-safe for root categories
CREATE UNIQUE INDEX IF NOT EXISTS categories_unique_name_per_parent
ON public.categories (
  user_id,
  name,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
