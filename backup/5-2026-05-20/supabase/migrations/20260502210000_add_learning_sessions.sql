-- Learning Sessions: general study tracking (any subject, not just Shas)
CREATE TABLE IF NOT EXISTS public.learning_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date text NOT NULL,                        -- yyyy-mm-dd
  subject text NOT NULL,                     -- נושא (גמרא / הלכה / פרשה / כל נושא)
  session_type text NOT NULL DEFAULT 'initial'
    CHECK (session_type IN ('initial', 'review')),
  quality smallint CHECK (quality BETWEEN 1 AND 5),
  duration_minutes smallint,
  note text,
  next_review_date text,                     -- yyyy-mm-dd לחזרה הבאה
  review_number integer NOT NULL DEFAULT 1,  -- 1=ראשון, 2,3...=חזרה מספר
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_sessions_user_idx
  ON public.learning_sessions(user_id);

CREATE INDEX IF NOT EXISTS learning_sessions_date_idx
  ON public.learning_sessions(user_id, date);

ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "learning_sessions_all_own"
  ON public.learning_sessions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Auto-update updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
    CREATE TRIGGER learning_sessions_touch
      BEFORE UPDATE ON public.learning_sessions
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END$$;
