CREATE OR REPLACE FUNCTION public.scn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.source_change_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  source_user_id uuid NOT NULL,
  original_card_id uuid,
  forked_card_id uuid,
  original_question text,
  note text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_change_notes TO authenticated;
GRANT ALL ON public.source_change_notes TO service_role;

ALTER TABLE public.source_change_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY scn_insert_own ON public.source_change_notes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY scn_select_own_or_target ON public.source_change_notes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR source_user_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY scn_update_target_or_admin ON public.source_change_notes
  FOR UPDATE TO authenticated
  USING (source_user_id = auth.uid() OR is_admin(auth.uid()))
  WITH CHECK (source_user_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY scn_delete_target_or_admin ON public.source_change_notes
  FOR DELETE TO authenticated
  USING (source_user_id = auth.uid() OR is_admin(auth.uid()));

CREATE INDEX idx_scn_source_user_status ON public.source_change_notes(source_user_id, status, created_at DESC);
CREATE INDEX idx_scn_user ON public.source_change_notes(user_id, created_at DESC);

CREATE TRIGGER update_scn_updated_at
  BEFORE UPDATE ON public.source_change_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.scn_set_updated_at();