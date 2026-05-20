-- Generic UI preferences bucket per user
-- Stores: { showCalendarSubjects?: boolean, showStudiedBadge?: boolean, ... }
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_settings.ui_prefs IS
  'Per-user UI preferences (toggles, display options).';
