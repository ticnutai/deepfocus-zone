-- Enforce global question uniqueness per user (across all decks/categories).
-- This guarantees that the same question text cannot be inserted twice in any flow.

DROP INDEX IF EXISTS public.cards_unique_question_per_deck;
DROP INDEX IF EXISTS public.cards_unique_question_global;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, md5(trim(coalesce(question, '')))
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.cards
)
DELETE FROM public.cards c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- Remove broken deck links that may point to cards removed by dedupe.
DELETE FROM public.card_decks cd
WHERE NOT EXISTS (
  SELECT 1
  FROM public.cards c
  WHERE c.id = cd.card_id
);

CREATE UNIQUE INDEX cards_unique_question_global
ON public.cards (
  user_id,
  md5(trim(coalesce(question, '')))
);
