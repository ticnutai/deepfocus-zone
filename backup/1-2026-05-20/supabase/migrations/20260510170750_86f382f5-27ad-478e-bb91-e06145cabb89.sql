ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS quiz_plans jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quiz_attempts jsonb NOT NULL DEFAULT '[]'::jsonb;