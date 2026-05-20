ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS shas_plans jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_shas_plan_id text;