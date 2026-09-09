-- Old synthetic role identifiers are text, not UUIDs. They must not break
-- saves for real roles during migration of existing installations.
DO $$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('public.admin_save_access_profile(text,jsonb,jsonb,uuid[],jsonb,jsonb,bigint)'::regprocedure);
  definition:=replace(definition,$s$(x->>'roleId')::uuid=ANY(roles)$s$,$s$(x->>'roleId')=ANY(roles::text[])$s$);
  EXECUTE definition;
END $$;
