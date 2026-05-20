-- Add general_plans JSONB column to user_settings (stores all general study plans per user)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS general_plans jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Also ensure review_intervals and tab_config columns exist (added in-app but may be missing from migration history)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS review_intervals jsonb,
  ADD COLUMN IF NOT EXISTS tab_config jsonb;
