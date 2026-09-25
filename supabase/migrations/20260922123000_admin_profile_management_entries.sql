-- The cloned administrator view starts from the registered user's clean view,
-- but management and settings must remain visible so it can be edited.
DO $$
DECLARE setting_key text;
DECLARE current_value jsonb;
DECLARE next_value jsonb;
BEGIN
  FOREACH setting_key IN ARRAY ARRAY['feature_blocklist_profiles_v1','feature_blocklist_profiles_mobile_v1'] LOOP
    SELECT value INTO current_value FROM public.site_settings WHERE key=setting_key FOR UPDATE;
    SELECT coalesce(jsonb_agg(
      CASE WHEN x->>'id' LIKE 'access-admin-%' THEN
        jsonb_set(x,'{blocklist,sections}',coalesce((
          SELECT jsonb_agg(section)
          FROM jsonb_array_elements_text(coalesce(x#>'{blocklist,sections}','[]'::jsonb)) section
          WHERE section NOT IN ('admin','settings')
        ),'[]'::jsonb),true)
      ELSE x END
    ),'[]'::jsonb) INTO next_value
    FROM jsonb_array_elements(coalesce(current_value,'[]'::jsonb)) x;
    UPDATE public.site_settings SET value=next_value WHERE key=setting_key;
  END LOOP;
  IF EXISTS(
    SELECT 1 FROM public.site_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value) x
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(x#>'{blocklist,sections}','[]'::jsonb)) section
    WHERE s.key IN ('feature_blocklist_profiles_v1','feature_blocklist_profiles_mobile_v1')
      AND x->>'id' LIKE 'access-admin-%' AND section IN ('admin','settings')
  ) THEN RAISE EXCEPTION 'Administrator management entries remain hidden'; END IF;
END $$;
NOTIFY pgrst,'reload schema';
