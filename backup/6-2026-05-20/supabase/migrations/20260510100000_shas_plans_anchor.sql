-- Add anchor date/position fields to shas_plans
ALTER TABLE public.shas_plans
  ADD COLUMN IF NOT EXISTS anchor_date DATE,
  ADD COLUMN IF NOT EXISTS anchor_masechta TEXT,
  ADD COLUMN IF NOT EXISTS anchor_daf SMALLINT,
  ADD COLUMN IF NOT EXISTS anchor_amud SMALLINT;
