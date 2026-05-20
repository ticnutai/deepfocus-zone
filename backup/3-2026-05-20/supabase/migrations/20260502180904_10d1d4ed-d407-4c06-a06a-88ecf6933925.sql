-- Per-user review interval configuration (days)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS review_intervals jsonb NOT NULL DEFAULT '[1,3,7,14,30]'::jsonb;

-- Scheduled Shas reviews (תזכורות חזרה על דפים שלמדתי)
CREATE TABLE IF NOT EXISTS public.shas_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  masechta text NOT NULL,
  daf integer NOT NULL,
  amud smallint NOT NULL DEFAULT 1,
  half smallint,
  unit text NOT NULL DEFAULT 'daf',
  -- אינדקס איזו חזרה ברצף (1 = ראשונה, 2 = שנייה...)
  review_index integer NOT NULL DEFAULT 1,
  -- תאריך מתוזמן
  due_date date NOT NULL,
  -- תאריך ביצוע בפועל (אם נעשה)
  done_at date,
  -- האם זו רשומת "לימוד ראשון" (ולא חזרה)
  is_initial boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shas_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shas_reviews_all_own ON public.shas_reviews;
CREATE POLICY shas_reviews_all_own ON public.shas_reviews
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_shas_reviews_user_due ON public.shas_reviews(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_shas_reviews_user_done ON public.shas_reviews(user_id, done_at);

DROP TRIGGER IF EXISTS trg_shas_reviews_touch ON public.shas_reviews;
CREATE TRIGGER trg_shas_reviews_touch
  BEFORE UPDATE ON public.shas_reviews
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();