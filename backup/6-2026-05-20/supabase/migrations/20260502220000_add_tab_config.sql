-- Add tab_config column to user_settings for per-user tab order/visibility
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS tab_config jsonb;
