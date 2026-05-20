CREATE INDEX IF NOT EXISTS idx_cards_user_created ON public.cards (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cards_user_unreviewed_created
  ON public.cards (user_id, created_at)
  WHERE srs IS NULL OR srs->>'lastReviewedAt' IS NULL OR srs->>'lastReviewedAt' = 'null';

CREATE INDEX IF NOT EXISTS idx_review_logs_user_at ON public.review_logs (user_id, at DESC);