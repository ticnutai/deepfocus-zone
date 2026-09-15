-- Source moderation does not transfer ownership, copy cards or unhide content.
CREATE TABLE public.question_source_approval_rules (
 source_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 updated_by uuid REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.question_source_approval_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_source_approval_rules FROM anon,authenticated;

DROP FUNCTION public.get_admin_question_source_tags();
CREATE FUNCTION public.get_admin_question_source_tags()
RETURNS TABLE(source_id text,question_count bigint,approved_count bigint,pending_count bigint,hidden_count bigint,auto_approve boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT s.id,count(*),count(*) FILTER(WHERE c.moderation_status IN ('reviewed','published')),
 count(*) FILTER(WHERE c.moderation_status='private'),count(*) FILTER(WHERE c.moderation_status='hidden'),coalesce(r.enabled,false)
 FROM public.cards c CROSS JOIN LATERAL unnest(public.question_source_ids(c.tags)) s(id)
 LEFT JOIN public.question_source_approval_rules r ON r.source_id=s.id
 WHERE c.deleted_at IS NULL GROUP BY s.id,r.enabled ORDER BY s.id;
END $$;

CREATE FUNCTION public.admin_approve_question_source(p_source_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE affected bigint;
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 UPDATE public.cards SET moderation_status='reviewed',moderated_by=auth.uid(),moderated_at=now(),updated_at=now()
 WHERE deleted_at IS NULL AND moderation_status='private' AND p_source_id=ANY(public.question_source_ids(tags));
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END $$;

CREATE FUNCTION public.admin_set_source_auto_approval(p_source_id text,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cards WHERE deleted_at IS NULL AND p_source_id=ANY(public.question_source_ids(tags))) THEN RAISE EXCEPTION 'Unknown source'; END IF;
 INSERT INTO public.question_source_approval_rules(source_id,enabled,updated_by) VALUES(p_source_id,p_enabled,auth.uid())
 ON CONFLICT(source_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
END $$;

-- Only trusted administrator imports. A regular user cannot self-approve by adding a source tag.
CREATE FUNCTION public.auto_approve_admin_source_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.deleted_at IS NULL AND NEW.moderation_status='private' AND coalesce(public.is_admin(auth.uid()),false)
 AND EXISTS(SELECT 1 FROM public.question_source_approval_rules r WHERE r.enabled AND r.source_id=ANY(public.question_source_ids(NEW.tags))) THEN
 NEW.moderation_status:='reviewed'; NEW.moderated_by:=auth.uid(); NEW.moderated_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_auto_approval BEFORE INSERT ON public.cards FOR EACH ROW EXECUTE FUNCTION public.auto_approve_admin_source_insert();
REVOKE ALL ON FUNCTION public.get_admin_question_source_tags(),public.admin_approve_question_source(text),public.admin_set_source_auto_approval(text,boolean),public.auto_approve_admin_source_insert() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_admin_question_source_tags(),public.admin_approve_question_source(text),public.admin_set_source_auto_approval(text,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
