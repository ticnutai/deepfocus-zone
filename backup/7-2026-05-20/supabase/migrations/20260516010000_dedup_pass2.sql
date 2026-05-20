-- Second-pass dedup: catches duplicates missed by first pass (trim whitespace, exact-same created_at, etc.)
-- Also rebuilds unique indexes using trim(question) for whitespace-safe uniqueness.

-- Step 1: Drop the indexes from the first pass (so we can recreate with better expressions)
DROP INDEX IF EXISTS public.cards_unique_question_per_deck;
DROP INDEX IF EXISTS public.categories_unique_name_per_parent;

-- Step 2: Delete remaining duplicate card_decks rows
DELETE FROM public.card_decks
WHERE card_id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id,
                     COALESCE(deck_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     md5(trim(question))
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.cards
  ) ranked
  WHERE rn > 1
);

-- Step 3: Delete remaining duplicate cards
DELETE FROM public.cards
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id,
                     COALESCE(deck_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     md5(trim(question))
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.cards
  ) ranked
  WHERE rn > 1
);

-- Step 4: Delete remaining duplicate categories
DELETE FROM public.categories
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id,
                     trim(name),
                     COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.categories
  ) ranked
  WHERE rn > 1
);

-- Step 5: Recreate unique index on cards using trim(question)
CREATE UNIQUE INDEX cards_unique_question_per_deck
ON public.cards (
  user_id,
  COALESCE(deck_id, '00000000-0000-0000-0000-000000000000'::uuid),
  md5(trim(question))
);

-- Step 6: Recreate unique index on categories using trim(name)
CREATE UNIQUE INDEX categories_unique_name_per_parent
ON public.categories (
  user_id,
  trim(name),
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
