-- Delete the 13,348 flashcard twin cards (created from multiple-choice cards).
-- These are no longer needed because "multiple" DB cards now map to "combo" in the
-- app, which supports both flashcard and MC study modes via comboPref setting.

DELETE FROM public.card_decks
WHERE card_id IN (
  SELECT id FROM public.cards
  WHERE user_id = '3e108a41-8da6-4f36-98cd-2b38916708b8'
    AND type = 'flashcard'
);

DELETE FROM public.review_logs
WHERE card_id IN (
  SELECT id FROM public.cards
  WHERE user_id = '3e108a41-8da6-4f36-98cd-2b38916708b8'
    AND type = 'flashcard'
);

DELETE FROM public.cards
WHERE user_id = '3e108a41-8da6-4f36-98cd-2b38916708b8'
  AND type = 'flashcard';

-- Delete the flashcard deck itself
DELETE FROM public.decks
WHERE id = 'b5e2f1a3-7c9d-4e8f-a012-3b4c5d6e7f8a'
  AND user_id = '3e108a41-8da6-4f36-98cd-2b38916708b8';
