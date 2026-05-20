UPDATE public.cards
SET tags = COALESCE(tags, '[]'::jsonb) || '["source:shemesh"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) t
  WHERE t LIKE 'source:%'
);