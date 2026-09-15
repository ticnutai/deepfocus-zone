-- Empty source/contributor selections cannot return shared cards; avoid a full scan.
DO $$ DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('public.get_content_unreviewed_cards_page(integer,integer)'::regprocedure);
 changed:=replace(original,'return coalesce((select jsonb_agg(row_json)',
 'IF cardinality(uids)=0 AND coalesce(jsonb_array_length(p->''source_tags''),0)=0 AND NOT coalesce((p->>''include_site_library'')::boolean,false) THEN RETURN ''[]''::jsonb; END IF;
  return coalesce((select jsonb_agg(row_json)');
 IF changed=original THEN RAISE EXCEPTION 'Page function drift'; END IF;
 EXECUTE changed;
END; $$;
NOTIFY pgrst,'reload schema';
