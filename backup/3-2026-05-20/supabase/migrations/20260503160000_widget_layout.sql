-- Add widget_layout JSONB column to user_settings (per-user widget order/size/visibility per tab)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS widget_layout jsonb DEFAULT NULL;

-- Update the Supabase generated types comment
COMMENT ON COLUMN public.user_settings.widget_layout IS 'Per-tab widget layout: order, size (half/full), visibility';
