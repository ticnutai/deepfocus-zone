-- Extend the existing catalogs. Only the function return shape changes; no data is removed.
DROP FUNCTION public.get_admin_question_source_tags();
CREATE FUNCTION public.get_admin_question_source_tags() RETURNS TABLE(source_id text,question_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT s.id,count(*) FROM public.cards c
 CROSS JOIN LATERAL unnest(public.question_source_ids(c.tags)) s(id)
 WHERE c.deleted_at IS NULL GROUP BY s.id ORDER BY s.id;
END $$;
REVOKE ALL ON FUNCTION public.get_admin_question_source_tags() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_admin_question_source_tags() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_content_sources()
RETURNS TABLE(source_user_id uuid,label text,email text,question_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH counts AS (SELECT coalesce(c.created_by,c.user_id) AS creator,count(*) AS total
  FROM public.cards c WHERE c.deleted_at IS NULL GROUP BY coalesce(c.created_by,c.user_id))
 SELECT p.id,coalesce(nullif(p.display_name,''),nullif(p.username,''),nullif(p.email,''),p.id::text),p.email,coalesce(c.total,0)
 FROM public.profiles p LEFT JOIN counts c ON c.creator=p.id WHERE public.is_admin(auth.uid()) ORDER BY 2;
$$;
NOTIFY pgrst,'reload schema';
