-- Apply the proven empty-selection fast path to bootstrap and category links too.
DO $$ DECLARE name text; original text; changed text; guard text;
BEGIN
 FOREACH name IN ARRAY ARRAY['get_content_overlay_snapshot()','get_content_card_categories()'] LOOP
  original:=pg_get_functiondef(('public.'||name)::regprocedure);
  guard:='IF cardinality(uids)=0 AND coalesce(jsonb_array_length(p->''source_tags''),0)=0 AND NOT coalesce((p->>''include_site_library'')::boolean,false) THEN RETURN ';
  IF name='get_content_overlay_snapshot()' THEN
   guard:=guard||'jsonb_build_object(''content_access'',p,''source_user_ids'',to_jsonb(uids),''decks'',''[]''::jsonb,''cards'',''[]''::jsonb,''cards_total_count'',0,''card_decks'',''[]''::jsonb,''categories_roots'',''[]''::jsonb); END IF;';
   changed:=replace(original,'return jsonb_build_object(',guard||E'\nreturn jsonb_build_object(');
  ELSE
   guard:=guard||'''[]''::jsonb; END IF;';
   changed:=replace(original,'return coalesce((select jsonb_agg(to_jsonb(cc))',guard||E'\nreturn coalesce((select jsonb_agg(to_jsonb(cc))');
  END IF;
  IF changed=original THEN RAISE EXCEPTION 'Empty access path drift: %',name; END IF;
  EXECUTE changed;
 END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
