-- Parent-first lookup is required for FK cascade checks. User-first indexes
-- cannot serve it. Reuse any existing suitable index, regardless of its name.
DO $$ DECLARE item record; att smallint;
BEGIN
 FOR item IN SELECT * FROM (VALUES
   ('public.categories','parent_id','categories_parent_fk_lookup'),
   ('public.card_categories','category_id','card_categories_category_fk_lookup')
 ) AS wanted(tab,col,idx) LOOP
   SELECT attnum INTO att FROM pg_attribute WHERE attrelid=item.tab::regclass AND attname=item.col;
   IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid=item.tab::regclass AND indisvalid AND indpred IS NULL AND indkey[0]=att) THEN
     EXECUTE format('CREATE INDEX %I ON %s (%I)',item.idx,item.tab,item.col);
   END IF;
 END LOOP;
END; $$;
