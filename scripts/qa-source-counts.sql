DO $$ DECLARE denied boolean:=false;
BEGIN
 IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin test required'; END IF;
 IF EXISTS(WITH expected AS MATERIALIZED (SELECT tag,count(*) FILTER(WHERE c.moderation_status IN ('reviewed','published')) approved,
 count(*) FILTER(WHERE c.moderation_status='private') pending,count(*) FILTER(WHERE c.moderation_status='hidden') hidden
 FROM public.cards c CROSS JOIN LATERAL unnest(public.question_source_ids(c.tags)) tag WHERE c.deleted_at IS NULL GROUP BY tag)
 SELECT 1 FROM public.get_admin_question_source_tags() s JOIN expected e ON e.tag=s.source_id
 WHERE s.approved_count<>e.approved OR s.pending_count<>e.pending OR s.hidden_count<>e.hidden) THEN RAISE EXCEPTION 'Moderation count mismatch'; END IF;
 IF EXISTS(WITH expected AS MATERIALIZED (SELECT tag,count(*) AS total FROM public.cards c
  CROSS JOIN LATERAL unnest(public.question_source_ids(c.tags)) tag WHERE c.deleted_at IS NULL GROUP BY tag)
  SELECT 1 FROM public.get_admin_question_source_tags() s FULL JOIN expected e ON e.tag=s.source_id
  WHERE s.question_count IS DISTINCT FROM e.total) THEN RAISE EXCEPTION 'Source count mismatch'; END IF;
 IF EXISTS(WITH expected AS MATERIALIZED (SELECT coalesce(c.created_by,c.user_id) AS creator,count(*) AS total
  FROM public.cards c WHERE c.deleted_at IS NULL GROUP BY coalesce(c.created_by,c.user_id))
  SELECT 1 FROM public.get_admin_content_sources() s LEFT JOIN expected e ON e.creator=s.source_user_id
  WHERE s.question_count IS DISTINCT FROM coalesce(e.total,0)) THEN RAISE EXCEPTION 'Contributor count mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.get_admin_question_source_tags() WHERE question_count>0) THEN RAISE EXCEPTION 'Empty catalog'; END IF;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  BEGIN PERFORM * FROM public.get_admin_question_source_tags(); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Anonymous catalog leak'; END IF;
  IF EXISTS(SELECT 1 FROM public.get_admin_content_sources()) THEN RAISE EXCEPTION 'Anonymous contributors leak'; END IF;
  RAISE EXCEPTION 'rollback context' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
END $$;
