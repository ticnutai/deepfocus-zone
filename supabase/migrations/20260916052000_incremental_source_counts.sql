-- Derived exact counters; cards remain the only source of truth.
-- Atomic backfill + trigger installation prevents missed concurrent changes.
SET LOCAL jit=off;
LOCK TABLE public.cards IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.question_source_counts (
 source_id text PRIMARY KEY, question_count bigint NOT NULL DEFAULT 0,
 approved_count bigint NOT NULL DEFAULT 0,pending_count bigint NOT NULL DEFAULT 0,hidden_count bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.question_source_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_source_counts FROM PUBLIC,anon,authenticated;
INSERT INTO public.question_source_counts
 SELECT s.source_id,s.question_count,s.approved_count,s.pending_count,s.hidden_count
 FROM public.get_admin_question_source_tags() s;

CREATE FUNCTION public.adjust_question_source_counts(p_tags jsonb,p_status text,p_delta integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE source text;
BEGIN
 FOR source IN SELECT unnest(public.question_source_ids(p_tags)) ORDER BY 1 LOOP
  INSERT INTO public.question_source_counts(source_id,question_count,approved_count,pending_count,hidden_count)
  VALUES(source,p_delta,CASE WHEN p_status IN ('reviewed','published') THEN p_delta ELSE 0 END,
   CASE WHEN p_status='private' THEN p_delta ELSE 0 END,CASE WHEN p_status='hidden' THEN p_delta ELSE 0 END)
  ON CONFLICT(source_id) DO UPDATE SET
   question_count=question_source_counts.question_count+excluded.question_count,
   approved_count=question_source_counts.approved_count+excluded.approved_count,
   pending_count=question_source_counts.pending_count+excluded.pending_count,
   hidden_count=question_source_counts.hidden_count+excluded.hidden_count;
 END LOOP;
END $$;
CREATE FUNCTION public.maintain_question_source_counts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.tags IS NOT DISTINCT FROM NEW.tags AND OLD.moderation_status IS NOT DISTINCT FROM NEW.moderation_status AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' THEN IF OLD.deleted_at IS NULL THEN PERFORM public.adjust_question_source_counts(OLD.tags,OLD.moderation_status,-1); END IF; END IF;
 IF TG_OP<>'DELETE' THEN IF NEW.deleted_at IS NULL THEN PERFORM public.adjust_question_source_counts(NEW.tags,NEW.moderation_status,1); END IF; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER maintain_question_source_counts AFTER INSERT OR UPDATE OR DELETE ON public.cards
 FOR EACH ROW EXECUTE FUNCTION public.maintain_question_source_counts();
REVOKE ALL ON FUNCTION public.adjust_question_source_counts(jsonb,text,integer),public.maintain_question_source_counts() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_question_source_tags()
RETURNS TABLE(source_id text,question_count bigint,approved_count bigint,pending_count bigint,hidden_count bigint,auto_approve boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET jit=off AS $$
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT s.source_id,s.question_count,s.approved_count,s.pending_count,s.hidden_count,coalesce(r.enabled,false)
 FROM public.question_source_counts s LEFT JOIN public.question_source_approval_rules r ON r.source_id=s.source_id
 WHERE s.question_count>0 ORDER BY s.source_id;
END $$;
NOTIFY pgrst,'reload schema';
