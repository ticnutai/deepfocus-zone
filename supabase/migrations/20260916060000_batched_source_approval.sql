-- One short atomic batch per call. Repeating only targets still-private rows.
CREATE INDEX IF NOT EXISTS cards_pending_source_tags_idx ON public.cards USING gin(tags)
 WHERE deleted_at IS NULL AND moderation_status='private';
CREATE OR REPLACE FUNCTION public.admin_approve_question_source(p_source_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET jit=off SET lock_timeout='3s' AS $$
DECLARE affected bigint;
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF p_source_id IS NULL OR p_source_id='' THEN RAISE EXCEPTION 'Source required'; END IF;
 WITH batch AS MATERIALIZED (
  SELECT c.id FROM public.cards c WHERE c.deleted_at IS NULL AND c.moderation_status='private'
  AND CASE WHEN p_source_id='unattributed' THEN public.question_source_ids(c.tags)=ARRAY['unattributed']
   ELSE c.tags @> jsonb_build_array('source:'||p_source_id) END
  ORDER BY c.id LIMIT 100 FOR UPDATE
 )
 UPDATE public.cards c SET moderation_status='reviewed',moderated_by=auth.uid(),moderated_at=now(),updated_at=now()
 FROM batch b WHERE c.id=b.id AND c.moderation_status='private' AND c.deleted_at IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;
NOTIFY pgrst,'reload schema';
