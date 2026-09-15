-- Avoid a per-card SQL aggregate over provenance tags during filtered pagination.
CREATE OR REPLACE FUNCTION public.matches_shared_question_access(tags jsonb, creator uuid, owner_id uuid, status text, policy jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE source text; selected jsonb:=policy->'source_tags';
BEGIN
 IF owner_id::text=policy->>'central_source_user_id'
  AND coalesce((policy->>'include_site_library')::boolean,false)
  AND coalesce(jsonb_typeof(selected),'null')='null' THEN RETURN true; END IF;
 IF coalesce((policy->>'approved_only')::boolean,true) AND coalesce(status,'') NOT IN ('reviewed','published') THEN RETURN false; END IF;
 IF coalesce(policy->'source_user_ids','[]'::jsonb) ? creator::text THEN RETURN true; END IF;
 IF jsonb_typeof(selected) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR source IN SELECT jsonb_array_elements_text(selected) LOOP
  IF source<>'unattributed' AND source NOT LIKE 'client:%' AND coalesce(tags,'[]'::jsonb) ? ('source:'||source) THEN RETURN true; END IF;
 END LOOP;
 IF selected ? 'unattributed' THEN
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(tags)='array' THEN tags ELSE '[]'::jsonb END) t
   WHERE t LIKE 'source:%' AND t NOT LIKE 'source:client:%');
 END IF;
 RETURN false;
END; $$;
