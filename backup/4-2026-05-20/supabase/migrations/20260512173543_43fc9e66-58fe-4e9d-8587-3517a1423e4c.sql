
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS masechta text,
  ADD COLUMN IF NOT EXISTS daf smallint,
  ADD COLUMN IF NOT EXISTS amud smallint;

CREATE INDEX IF NOT EXISTS idx_cards_user_daf
  ON public.cards(user_id, masechta, daf, amud)
  WHERE masechta IS NOT NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('gemara-pages', 'gemara-pages', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gemara_pages_public_read" ON storage.objects;
CREATE POLICY "gemara_pages_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'gemara-pages');

DROP POLICY IF EXISTS "gemara_pages_admin_insert" ON storage.objects;
CREATE POLICY "gemara_pages_admin_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gemara-pages' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "gemara_pages_admin_update" ON storage.objects;
CREATE POLICY "gemara_pages_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'gemara-pages' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "gemara_pages_admin_delete" ON storage.objects;
CREATE POLICY "gemara_pages_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'gemara-pages' AND public.is_admin(auth.uid()));
