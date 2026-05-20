-- Add general_plan_reviews JSONB column to user_settings
-- Stores review schedule entries for general study plan units
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS general_plan_reviews jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.user_settings.general_plan_reviews IS 'Per-user plan review schedule: [{id, planId, planTitle, unit, dueDate, doneAt, reviewIndex, createdAt}]';
