-- Avoid one SQL-function invocation per tag group. Preserve question_source_ids semantics.
CREATE OR REPLACE FUNCTION public.get_admin_question_source_tags()
RETURNS TABLE(source_id text,question_count bigint,approved_count bigint,pending_count bigint,hidden_count bigint,auto_approve boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET jit=off AS $$
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 WITH per_card AS MATERIALIZED (
  SELECT DISTINCT c.id,c.moderation_status,coalesce(substring(t.tag from 8),'unattributed') source
  FROM public.cards c
  LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.tags)='array' THEN c.tags ELSE '[]'::jsonb END) t(tag)
   ON t.tag LIKE 'source:%' AND t.tag NOT LIKE 'source:client:%'
  WHERE c.deleted_at IS NULL
 ), counts AS (
  SELECT p.source,count(*) total,count(*) FILTER(WHERE p.moderation_status IN ('reviewed','published')) approved,
   count(*) FILTER(WHERE p.moderation_status='private') pending,count(*) FILTER(WHERE p.moderation_status='hidden') hidden
  FROM per_card p GROUP BY p.source
 ) SELECT s.source,s.total,s.approved,s.pending,s.hidden,coalesce(r.enabled,false)
 FROM counts s LEFT JOIN public.question_source_approval_rules r ON r.source_id=s.source ORDER BY s.source;
END $$;
NOTIFY pgrst,'reload schema';
