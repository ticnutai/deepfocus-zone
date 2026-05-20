ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS widget_layout_updated_at timestamptz;