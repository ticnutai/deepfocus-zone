
-- Many-to-many: card can belong to multiple decks
CREATE TABLE public.card_decks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id uuid NOT NULL,
  deck_id uuid NOT NULL,
  user_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(card_id, deck_id)
);

ALTER TABLE public.card_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_decks_all_own" ON public.card_decks
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_card_decks_card ON public.card_decks(card_id);
CREATE INDEX idx_card_decks_deck ON public.card_decks(deck_id);
CREATE INDEX idx_card_decks_user ON public.card_decks(user_id);

-- Add sort_order to categories for drag reordering
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Add sort_order to cards for ordering within a deck
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
