-- One canonical attempt history for general practice and built exams.
-- JSON is retained in the existing per-user settings row so the established
-- IndexedDB-first offline sync can merge it without a second sync pipeline.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS practice_results jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.user_settings.practice_results IS
  'Canonical completed practice attempts with immutable exam/question snapshots; stored locally first and synced per user.';
