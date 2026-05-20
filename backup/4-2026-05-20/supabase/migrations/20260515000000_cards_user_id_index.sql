-- Performance: Add index on cards(user_id) to avoid full-table scans.
-- Without this, every bootstrap query does a sequential scan of ALL cards.
-- With 10K+ cards, this alone is the main cause of the 16s bootstrap time.
--
-- Also indexes card_decks(user_id, card_id) for the active-cards filter,
-- and a GIN index on cards.tags for category-based filtering.

-- Primary fix: index cards by user
CREATE INDEX IF NOT EXISTS idx_cards_user_id
  ON public.cards (user_id);

-- Composite: user + deck_id — lets us quickly find cards in a specific deck
CREATE INDEX IF NOT EXISTS idx_cards_user_deck_id
  ON public.cards (user_id, deck_id)
  WHERE deck_id IS NOT NULL;

-- card_decks join table: find cards linked to a deck by user
CREATE INDEX IF NOT EXISTS idx_card_decks_user_card
  ON public.card_decks (user_id, card_id);

-- GIN index on tags array — needed for fast category-tag filtering
-- (cards store category membership as tags: ["cat:SomeName"])
CREATE INDEX IF NOT EXISTS idx_cards_tags_gin
  ON public.cards USING GIN (tags);
