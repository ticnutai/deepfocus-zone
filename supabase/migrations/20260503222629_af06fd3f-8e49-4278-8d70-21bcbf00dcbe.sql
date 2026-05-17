
CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_settings_read_all"
ON public.site_settings FOR SELECT
TO authenticated, anon
USING (true);

CREATE POLICY "site_settings_admin_insert"
ON public.site_settings FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "site_settings_admin_update"
ON public.site_settings FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "site_settings_admin_delete"
ON public.site_settings FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

INSERT INTO public.site_settings (key, value)
VALUES ('dedication_banner', '{"text": "השימוש באתר זה הינו לזכות נאוה שרה בת מרים לזיווג הגון במהרה", "enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
