-- Aggregate repeated tag sets before source extraction; join rules only after counting.
-- Same signature, permissions, classification and exact counts; no content writes.
CREATE OR REPLACE FUNCTION public.get_admin_question_source_tags()
RETURNS TABLE(source_id text,question_count bigint,approved_count bigint,pending_count bigint,hidden_count bigint,auto_approve boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET jit=off AS $$
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 WITH tag_counts AS MATERIALIZED (
  SELECT c.tags,count(*) total,count(*) FILTER(WHERE c.moderation_status IN ('reviewed','published')) approved,
   count(*) FILTER(WHERE c.moderation_status='private') pending,count(*) FILTER(WHERE c.moderation_status='hidden') hidden
  FROM public.cards c WHERE c.deleted_at IS NULL GROUP BY c.tags
 ), source_counts AS (
  SELECT s.id,sum(t.total)::bigint total,sum(t.approved)::bigint approved,sum(t.pending)::bigint pending,sum(t.hidden)::bigint hidden
  FROM tag_counts t CROSS JOIN LATERAL unnest(public.question_source_ids(t.tags)) s(id) GROUP BY s.id
 )
 SELECT s.id,s.total,s.approved,s.pending,s.hidden,coalesce(r.enabled,false)
 FROM source_counts s LEFT JOIN public.question_source_approval_rules r ON r.source_id=s.id ORDER BY s.id;
END $$;
NOTIFY pgrst,'reload schema';
