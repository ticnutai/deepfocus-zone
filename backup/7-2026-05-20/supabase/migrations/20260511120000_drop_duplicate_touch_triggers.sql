-- Remove old *_touch triggers that duplicate the newer trg_*_set_updated_at triggers.
-- Both sets call updated_at = now(); keeping only the trg_* ones (added in 20260508130000).

DROP TRIGGER IF EXISTS decks_touch ON public.decks;
DROP TRIGGER IF EXISTS cards_touch ON public.cards;
DROP TRIGGER IF EXISTS goals_touch ON public.goals;
DROP TRIGGER IF EXISTS day_notes_touch ON public.day_notes;
DROP TRIGGER IF EXISTS learning_sessions_touch ON public.learning_sessions;
DROP TRIGGER IF EXISTS trg_shas_reviews_touch ON public.shas_reviews;

-- Also drop the old touch functions that are no longer used
-- (touch_updated_at is still referenced by profiles/decks/cards/goals/day_notes/user_settings
--  triggers that were created in the first migration — only drop if all dependents are gone)
-- We leave touch_updated_at in place since profiles_touch, user_settings_touch etc. still use it.
