-- Add customizable plan review intervals (per-user)
-- Default: [1, 7, 30, 90] (יום, שבוע, חודש, רבעון)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS plan_review_intervals jsonb NOT NULL DEFAULT '[1, 7, 30, 90]'::jsonb;
