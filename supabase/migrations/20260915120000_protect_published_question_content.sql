-- Private cloud backup is not publication. Lock only centrally published content.
-- Additive guard: preserves existing RLS, moderation RPC and every existing row.
CREATE OR REPLACE FUNCTION public.protect_published_question_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Trusted maintenance and existing admin publication flow retain their rights.
  IF auth.uid() IS NULL OR public.is_admin(auth.uid()) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.moderation_status <> 'private' OR NEW.published_card_id IS NOT NULL
       OR NEW.moderated_by IS NOT NULL OR NEW.moderated_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only administrators can moderate or publish questions' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.moderation_status IS DISTINCT FROM OLD.moderation_status
       OR NEW.published_card_id IS DISTINCT FROM OLD.published_card_id
       OR NEW.moderated_by IS DISTINCT FROM OLD.moderated_by
       OR NEW.moderated_at IS DISTINCT FROM OLD.moderated_at
       OR NEW.moderation_note IS DISTINCT FROM OLD.moderation_note THEN
      RAISE EXCEPTION 'Only administrators can change question ownership or moderation' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF OLD.published_card_id IS NOT NULL OR OLD.moderation_status = 'published' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Published questions can only be deleted by an administrator' USING ERRCODE = '42501';
    END IF;
    -- Personal study progress is mutable; question content and soft-deletion are not.
    IF (to_jsonb(NEW) - ARRAY['srs','stats','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['srs','stats','updated_at']) THEN
      RAISE EXCEPTION 'Published question content can only be changed by an administrator' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cards_protect_published_content ON public.cards;
CREATE TRIGGER cards_protect_published_content
BEFORE INSERT OR UPDATE OR DELETE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.protect_published_question_content();
