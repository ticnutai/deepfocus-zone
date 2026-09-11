-- Content-source access is part of the canonical access profile.
-- Additive migration: no users, questions, categories or study history are deleted.

set statement_timeout='120s';

alter table public.cards
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists origin_card_id uuid references public.cards(id) on delete set null;

create index if not exists cards_created_by_idx on public.cards(created_by);
create index if not exists cards_origin_card_idx on public.cards(origin_card_id);
create index if not exists cards_effective_creator_active_idx
on public.cards ((coalesce(created_by,user_id))) where deleted_at is null;

create or replace function public.set_card_provenance()
returns trigger language plpgsql set search_path=public as $$
declare v_tag text;
begin
  if new.created_by is null then
    select value into v_tag
    from jsonb_array_elements_text(coalesce(new.tags,'[]'::jsonb)) t(value)
    where value like 'source:user:%' limit 1;
    begin
      new.created_by := coalesce(nullif(substr(v_tag,13), '')::uuid, new.user_id);
    exception when others then
      new.created_by := new.user_id;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists cards_set_provenance on public.cards;
create trigger cards_set_provenance before insert or update of tags,created_by on public.cards
for each row execute function public.set_card_provenance();

create or replace function public.backfill_card_provenance(p_limit int default 4000)
returns int language plpgsql security definer set search_path=public as $$
declare changed int;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  with pending as (
    select id from public.cards where created_by is null limit least(greatest(p_limit,1),4000) for update skip locked
  )
  update public.cards c set created_by=coalesce((
    select substr(t.value,13)::uuid from jsonb_array_elements_text(coalesce(c.tags,'[]'::jsonb)) t(value)
    where t.value ~ '^source:user:[0-9a-fA-F-]{36}$' limit 1
  ),c.user_id) from pending where c.id=pending.id;
  get diagnostics changed=row_count;
  return changed;
end;
$$;
revoke all on function public.backfill_card_provenance(int) from public,anon;
grant execute on function public.backfill_card_provenance(int) to authenticated;

-- migration-chunk
select public.backfill_card_provenance(4000);
-- migration-chunk
select public.backfill_card_provenance(4000);
-- migration-chunk
select public.backfill_card_provenance(4000);
-- migration-chunk
select public.backfill_card_provenance(4000);
-- migration-chunk
select public.backfill_card_provenance(4000);
-- migration-chunk
select public.backfill_card_provenance(4000);
-- migration-chunk
select public.backfill_card_provenance(4000);
-- migration-chunk
select public.backfill_card_provenance(4000);

-- migration-chunk

create table if not exists public.role_content_access (
  role_id uuid primary key references public.app_roles(id) on delete cascade,
  include_own boolean not null default true,
  include_site_library boolean not null default false,
  approved_only boolean not null default true,
  source_user_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.role_content_access enable row level security;
revoke all on public.role_content_access from public,anon;
grant select,insert,update,delete on public.role_content_access to authenticated;
drop policy if exists role_content_access_admin on public.role_content_access;
create policy role_content_access_admin on public.role_content_access for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Preserve the current audiences while giving each role an independent rule.
insert into public.role_content_access(role_id,include_own,include_site_library,approved_only,source_user_ids)
select r.id, true,
  case
    when r.access_kind in ('anonymous_online','anonymous_offline') then coalesce((select (value->>'enabled')::boolean from public.site_settings where key='guest_source'),false)
    when r.access_kind in ('registered','registered_offline') then coalesce((select (value->>'enabled')::boolean from public.site_settings where key='source_overlay_for_users'),false)
    else false
  end,
  true,'{}'::uuid[]
from public.app_roles r where r.name <> 'admin'
on conflict(role_id) do nothing;

-- migration-chunk

create or replace function public.get_effective_content_access()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_uid uuid := auth.uid();
  v_is_anonymous boolean := false;
  v_include_own boolean := true;
  v_include_central boolean := false;
  v_approved_only boolean := true;
  v_sources uuid[] := '{}';
  v_central uuid := public.get_guest_source_user_id();
begin
  if v_uid is not null and public.is_admin(v_uid) then
    return jsonb_build_object('include_own',true,'include_site_library',false,'approved_only',false,
      'source_user_ids','[]'::jsonb,'central_source_user_id',v_central,'is_admin',true);
  end if;

  if v_uid is not null then
    select coalesce(is_anonymous,false) into v_is_anonymous from auth.users where id=v_uid;
  end if;

  with effective_roles as (
    select r.id
    from public.app_roles r
    where (v_uid is null and r.access_kind='anonymous_online')
       or (v_uid is not null and r.access_kind=case when v_is_anonymous then 'anonymous_online' else 'registered' end)
       or (v_uid is not null and r.access_kind is null and exists (
         select 1 from public.user_roles ur where ur.user_id=v_uid and ur.role_id=r.id
       ))
  ), rules as (
    select a.* from public.role_content_access a join effective_roles r on r.id=a.role_id
  )
  select coalesce(bool_or(include_own),true),coalesce(bool_or(include_site_library),false),
    coalesce(bool_and(approved_only),true),coalesce(array_agg(distinct source_id) filter(where source_id is not null),'{}'::uuid[])
  into v_include_own,v_include_central,v_approved_only,v_sources
  from rules left join lateral unnest(source_user_ids) as src(source_id) on true;

  if v_central is not null and v_include_central then
    v_sources := array(select distinct x from unnest(v_sources||array[v_central]) x where x is distinct from v_uid);
  else
    v_sources := array(select distinct x from unnest(v_sources) x where x is distinct from v_uid);
  end if;

  return jsonb_build_object('include_own',v_include_own,'include_site_library',v_include_central,
    'approved_only',v_approved_only,'source_user_ids',to_jsonb(v_sources),
    'central_source_user_id',v_central,'is_admin',false);
end;
$$;
revoke all on function public.get_effective_content_access() from public;
grant execute on function public.get_effective_content_access() to anon,authenticated;

-- migration-chunk

create or replace function public.get_content_overlay_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public set statement_timeout='30s' as $$
declare p jsonb := public.get_effective_content_access(); uids uuid[]; central_uid uuid; approved boolean;
begin
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into uids from jsonb_array_elements_text(coalesce(p->'source_user_ids','[]'));
  central_uid := nullif(p->>'central_source_user_id','')::uuid;
  approved := coalesce((p->>'approved_only')::boolean,true);
  return jsonb_build_object(
    'content_access',p,
    'source_user_ids',to_jsonb(uids),
    'decks',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.decks d
      where d.user_id=any(uids||case when central_uid is null then '{}'::uuid[] else array[central_uid] end) and d.deleted_at is null),'[]'::jsonb),
    'cards',coalesce((select jsonb_agg(q.row_json order by q.created_at) from (
      select to_jsonb(c)||jsonb_build_object('srs','{}'::jsonb,'stats','{"totalReviews":0,"correct":0,"incorrect":0}'::jsonb) row_json,c.created_at
      from public.cards c where c.deleted_at is null and c.user_id is distinct from auth.uid()
      and c.srs is not null and c.srs->>'lastReviewedAt' is not null and c.srs->>'lastReviewedAt'<>'null'
      and ((c.user_id=central_uid and coalesce((p->>'include_site_library')::boolean,false))
        or (coalesce(c.created_by,c.user_id)=any(uids) and (not approved or c.moderation_status in ('reviewed','published'))))
      order by c.created_at limit 1000
    ) q),'[]'::jsonb),
    'cards_total_count',(select count(*) from public.cards c where c.deleted_at is null and c.user_id is distinct from auth.uid()
      and ((c.user_id=central_uid and coalesce((p->>'include_site_library')::boolean,false))
        or (coalesce(c.created_by,c.user_id)=any(uids) and (not approved or c.moderation_status in ('reviewed','published'))))),
    'card_decks',coalesce((select jsonb_agg(to_jsonb(cd) order by cd.sort_order) from public.card_decks cd join public.cards c on c.id=cd.card_id
      where c.deleted_at is null and c.user_id is distinct from auth.uid()
      and ((c.user_id=central_uid and coalesce((p->>'include_site_library')::boolean,false))
        or (coalesce(c.created_by,c.user_id)=any(uids) and (not approved or c.moderation_status in ('reviewed','published'))))),'[]'::jsonb),
    'categories_roots',coalesce((select jsonb_agg(to_jsonb(ca) order by ca.sort_order nulls last,ca.created_at)
      from public.categories ca where ca.user_id=any(uids||case when central_uid is null then '{}'::uuid[] else array[central_uid] end) and ca.deleted_at is null),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_content_category_children(p_parent_id uuid default null)
returns table(id uuid,name text,parent_id uuid,color text,created_at timestamptz,sort_order integer,has_children boolean)
language plpgsql stable security definer set search_path=public as $$
declare p jsonb:=public.get_effective_content_access(); uids uuid[];
begin
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into uids from jsonb_array_elements_text(coalesce(p->'source_user_ids','[]'));
  return query select c.id,c.name,c.parent_id,c.color,c.created_at,c.sort_order,
    exists(select 1 from public.categories ch where ch.user_id=c.user_id and ch.parent_id=c.id and ch.deleted_at is null)
  from public.categories c where c.user_id=any(uids||case when public.get_guest_source_user_id() is null then '{}'::uuid[] else array[public.get_guest_source_user_id()] end)
    and c.deleted_at is null and c.parent_id is not distinct from p_parent_id;
end;
$$;

create or replace function public.get_content_unreviewed_cards_page(p_offset int default 0,p_limit int default 3000)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p jsonb:=public.get_effective_content_access(); uids uuid[]; central_uid uuid; approved boolean;
begin
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into uids from jsonb_array_elements_text(coalesce(p->'source_user_ids','[]'));
  central_uid:=nullif(p->>'central_source_user_id','')::uuid; approved:=coalesce((p->>'approved_only')::boolean,true);
  return coalesce((select jsonb_agg(row_json) from (
    select to_jsonb(c)||jsonb_build_object('srs','{}'::jsonb,'stats','{"totalReviews":0,"correct":0,"incorrect":0}'::jsonb) row_json
    from public.cards c where c.deleted_at is null and c.user_id is distinct from auth.uid()
      and ((c.user_id=central_uid and coalesce((p->>'include_site_library')::boolean,false))
        or (coalesce(c.created_by,c.user_id)=any(uids) and (not approved or c.moderation_status in ('reviewed','published'))))
    order by c.created_at offset greatest(p_offset,0) limit least(greatest(p_limit,1),1000)
  ) q),'[]'::jsonb);
end;
$$;

create or replace function public.get_content_card_categories()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p jsonb:=public.get_effective_content_access(); uids uuid[]; central_uid uuid; approved boolean;
begin
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into uids from jsonb_array_elements_text(coalesce(p->'source_user_ids','[]'));
  central_uid:=nullif(p->>'central_source_user_id','')::uuid; approved:=coalesce((p->>'approved_only')::boolean,true);
  return coalesce((select jsonb_agg(to_jsonb(cc)) from public.card_categories cc join public.cards c on c.id=cc.card_id
    where c.deleted_at is null and c.user_id is distinct from auth.uid()
      and ((c.user_id=central_uid and coalesce((p->>'include_site_library')::boolean,false))
        or (coalesce(c.created_by,c.user_id)=any(uids) and (not approved or c.moderation_status in ('reviewed','published'))))),'[]'::jsonb);
end;
$$;

revoke all on function public.get_content_overlay_snapshot() from public;
revoke all on function public.get_content_category_children(uuid) from public;
revoke all on function public.get_content_unreviewed_cards_page(int,int) from public;
revoke all on function public.get_content_card_categories() from public;
grant execute on function public.get_content_overlay_snapshot() to anon,authenticated;
grant execute on function public.get_content_category_children(uuid) to anon,authenticated;
grant execute on function public.get_content_unreviewed_cards_page(int,int) to anon,authenticated;
grant execute on function public.get_content_card_categories() to anon,authenticated;

-- migration-chunk

-- Compatibility wrappers: older clients may still send a source id, but the server
-- deliberately ignores it and derives the allowed sources from the active role.
create or replace function public.get_guest_bootstrap_snapshot_for(p_source_user_id uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$ select public.get_content_overlay_snapshot(); $$;
create or replace function public.get_guest_category_children_for(p_source_user_id uuid default null,p_parent_id uuid default null)
returns table(id uuid,name text,parent_id uuid,color text,created_at timestamptz,sort_order integer,has_children boolean)
language sql stable security definer set search_path=public as $$ select * from public.get_content_category_children(p_parent_id); $$;
create or replace function public.get_guest_unreviewed_cards_page_for(p_source_user_id uuid default null,p_offset int default 0,p_limit int default 500)
returns jsonb language sql stable security definer set search_path=public as $$ select public.get_content_unreviewed_cards_page(p_offset,p_limit); $$;
create or replace function public.get_guest_card_categories_for(p_source_user_id uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$ select public.get_content_card_categories(); $$;
create or replace function public.get_source_overlay_snapshot()
returns jsonb language sql stable security definer set search_path=public as $$ select public.get_content_overlay_snapshot(); $$;
create or replace function public.get_source_category_children(p_parent_id uuid default null)
returns table(id uuid,name text,parent_id uuid,color text,created_at timestamptz,sort_order integer,has_children boolean)
language sql stable security definer set search_path=public as $$ select * from public.get_content_category_children(p_parent_id); $$;
create or replace function public.get_source_unreviewed_cards_page(p_offset int default 0,p_limit int default 500)
returns jsonb language sql stable security definer set search_path=public as $$ select public.get_content_unreviewed_cards_page(p_offset,p_limit); $$;
create or replace function public.get_source_card_categories()
returns jsonb language sql stable security definer set search_path=public as $$ select public.get_content_card_categories(); $$;

-- migration-chunk

create or replace function public.get_admin_content_sources()
returns table(source_user_id uuid,label text,email text,question_count bigint)
language sql stable security definer set search_path=public as $$
  select p.id,coalesce(nullif(p.display_name,''),nullif(p.username,''),nullif(p.email,''),p.id::text),p.email,
    -1::bigint
  from public.profiles p where public.is_admin(auth.uid()) order by 2;
$$;
revoke all on function public.get_admin_content_sources() from public,anon;
grant execute on function public.get_admin_content_sources() to authenticated;

-- migration-chunk

-- Keep the existing atomic profile writer and add content access to the same transaction.
create or replace function public.admin_save_access_profile(
  p_scope text,p_layout jsonb,p_block jsonb,p_role_ids uuid[],
  p_permissions jsonb default null,p_expected_permissions jsonb default null,
  p_expected_updated_at bigint default null
) returns void language plpgsql security definer set search_path=public as $$
declare suffix text;pk text;bk text;ak text;ck text;pid text;profiles jsonb;blocks jsonb;links jsonb;blinks jsonb;
  current_version bigint;actual_permissions jsonb;roles uuid[];stamp bigint;content jsonb;source_ids uuid[];
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin access required'; end if;
  if p_scope is null or p_scope not in ('desktop','mobile') or jsonb_typeof(p_layout) is distinct from 'object' or jsonb_typeof(p_block) is distinct from 'object' then raise exception 'Invalid profile'; end if;
  pid:=p_layout->>'id';
  if pid is null or pid='' or p_block->>'id' is distinct from pid or coalesce(btrim(p_layout->>'name'),'')='' then raise exception 'Invalid profile identity'; end if;
  select coalesce(array_agg(distinct x),'{}'::uuid[]) into roles from unnest(coalesce(p_role_ids,'{}'::uuid[])) x;
  if exists(select 1 from unnest(roles) x left join public.app_roles r on r.id=x where r.id is null or r.name='admin') then raise exception 'Invalid role assignment'; end if;
  content:=coalesce(p_layout->'contentAccess','{"includeOwn":true,"includeSiteLibrary":false,"approvedOnly":true,"sourceUserIds":[]}'::jsonb);
  if jsonb_typeof(content) <> 'object' or jsonb_typeof(coalesce(content->'sourceUserIds','[]')) <> 'array' then raise exception 'Invalid content access'; end if;
  begin
    select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into source_ids from jsonb_array_elements_text(coalesce(content->'sourceUserIds','[]'));
  exception when others then raise exception 'Invalid content source id'; end;
  if exists(select 1 from unnest(source_ids) s where not exists(select 1 from public.profiles p where p.id=s)) then raise exception 'Unknown content source'; end if;
  perform pg_advisory_xact_lock(hashtext('access-profile-writer'));
  suffix:=case when p_scope='mobile' then '_mobile_v1' else '_v1' end;
  pk:='role_layout_profiles'||suffix;bk:='feature_blocklist_profiles'||suffix;ak:='role_layout_profile_assignments'||suffix;ck:='feature_blocklist_role_assignments'||suffix;
  select coalesce(value,'[]') into profiles from public.site_settings where key=pk;
  select coalesce(value,'[]') into blocks from public.site_settings where key=bk;
  select coalesce(value,'[]') into links from public.site_settings where key=ak;
  select coalesce(value,'[]') into blinks from public.site_settings where key=ck;
  profiles:=coalesce(profiles,'[]');blocks:=coalesce(blocks,'[]');links:=coalesce(links,'[]');blinks:=coalesce(blinks,'[]');
  select max((x->>'updatedAt')::bigint) into current_version from jsonb_array_elements(profiles||blocks) x where x->>'id'=pid;
  if current_version is distinct from p_expected_updated_at then raise exception 'הפרופיל השתנה בחלון אחר. רענן לפני שמירה'; end if;
  if p_permissions is not null then
    if jsonb_typeof(p_permissions)<>'array' then raise exception 'Invalid permission edits'; end if;
    perform 1 from public.role_permissions where role_id=any(roles) for update;
    select coalesce(jsonb_object_agg(role_id::text||':'||module::text||':'||action::text,allowed),'{}') into actual_permissions from public.role_permissions where role_id=any(roles);
    if actual_permissions is distinct from p_expected_permissions then raise exception 'ההרשאות השתנו בחלון או בתצוגה אחרת. רענן לפני שמירה'; end if;
    if exists(select 1 from jsonb_array_elements(p_permissions) x where not ((x->>'role_id')::uuid=any(roles)) or x->>'module' not in ('cards','decks','goals','shas','analytics','settings') or x->>'action' not in ('view','create','edit','delete','manage') or jsonb_typeof(x->'allowed')<>'boolean') then raise exception 'Invalid permission rows'; end if;
  elsif exists(select 1 from unnest(roles) r where not exists(select 1 from jsonb_array_elements(links) x where x->>'roleId'=r::text and x->>'profileId'=pid)) then raise exception 'New role assignments require explicit permission confirmation'; end if;
  stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  select coalesce(jsonb_agg(x),'[]') into profiles from jsonb_array_elements(profiles) x where x->>'id'<>pid;
  select coalesce(jsonb_agg(x),'[]') into blocks from jsonb_array_elements(blocks) x where x->>'id'<>pid;
  profiles:=profiles||jsonb_build_array(p_layout||jsonb_build_object('updatedAt',stamp));
  blocks:=blocks||jsonb_build_array(p_block||jsonb_build_object('updatedAt',stamp));
  select coalesce(jsonb_agg(x),'[]') into links from jsonb_array_elements(links) x where x->>'profileId'<>pid and not ((x->>'roleId')=any(roles::text[]));
  select coalesce(jsonb_agg(x),'[]') into blinks from jsonb_array_elements(blinks) x where x->>'profileId'<>pid and not ((x->>'roleId')=any(roles::text[]));
  links:=links||coalesce((select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'roleId',r,'profileId',pid)) from unnest(roles) r),'[]');
  blinks:=blinks||coalesce((select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'roleId',r,'profileId',pid)) from unnest(roles) r),'[]');
  insert into public.site_settings(key,value) values(pk,profiles),(bk,blocks),(ak,links),(ck,blinks) on conflict(key) do update set value=excluded.value;
  if p_permissions is not null then
    insert into public.role_permissions(role_id,module,action,allowed)
      select (x->>'role_id')::uuid,(x->>'module')::public.permission_module,(x->>'action')::public.permission_action,(x->>'allowed')::boolean from jsonb_array_elements(p_permissions) x
      on conflict(role_id,module,action) do update set allowed=excluded.allowed;
  end if;
  insert into public.role_content_access(role_id,include_own,include_site_library,approved_only,source_user_ids,updated_at,updated_by)
    select r,coalesce((content->>'includeOwn')::boolean,true),coalesce((content->>'includeSiteLibrary')::boolean,false),coalesce((content->>'approvedOnly')::boolean,true),source_ids,now(),auth.uid()
    from unnest(roles) r
    on conflict(role_id) do update set include_own=excluded.include_own,include_site_library=excluded.include_site_library,
      approved_only=excluded.approved_only,source_user_ids=excluded.source_user_ids,updated_at=now(),updated_by=auth.uid();
  if p_scope='desktop' then delete from public.role_layout_defaults where role_id=any(roles); end if;
end;
$$;
revoke all on function public.admin_save_access_profile(text,jsonb,jsonb,uuid[],jsonb,jsonb,bigint) from public,anon;
grant execute on function public.admin_save_access_profile(text,jsonb,jsonb,uuid[],jsonb,jsonb,bigint) to authenticated;
