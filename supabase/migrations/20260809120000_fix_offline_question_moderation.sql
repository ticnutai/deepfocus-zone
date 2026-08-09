-- Keep locally-created questions visible to administrators and publish them
-- atomically into the central library while preserving their classification.

-- Repair rows uploaded by older clients that were later associated with the
-- bundled-library owner. The stable device tag is the authoritative owner map.
update public.cards c
set user_id = d.user_id,
    updated_at = now()
from public.offline_question_devices d
where exists (
  select 1
  from jsonb_array_elements_text(coalesce(c.tags, '[]'::jsonb)) tag(value)
  where tag.value = 'source:offline-device:' || d.device_key::text
)
and c.user_id is distinct from d.user_id;

create or replace function public.submit_offline_question(
  p_device_key uuid,
  p_display_name text,
  p_local_username text,
  p_card jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_email text;
  v_question text := trim(coalesce(p_card->>'question', ''));
  v_type text := coalesce(nullif(p_card->>'type', ''), 'multiple');
  v_card_id uuid;
  v_device_tag text := 'source:offline-device:' || p_device_key::text;
begin
  if p_device_key is null then raise exception 'device key is required'; end if;
  if length(v_question) < 1 or length(v_question) > 20000 then raise exception 'invalid question'; end if;
  if v_type not in ('flashcard', 'multiple', 'boolean', 'combo') then raise exception 'invalid question type'; end if;
  begin v_card_id := (p_card->>'id')::uuid; exception when others then raise exception 'invalid card id'; end;

  select user_id into v_user_id
  from public.offline_question_devices
  where device_key = p_device_key;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    v_email := 'offline-' || replace(p_device_key::text, '-', '') || '@users.local';
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,confirmation_token,recovery_token)
    values ('00000000-0000-0000-0000-000000000000',v_user_id,'authenticated','authenticated',v_email,extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf')),now(),now(),now,'{"provider":"email","providers":["email"]}'::jsonb,jsonb_build_object('display_name',left(coalesce(nullif(trim(p_display_name),''),'אורח אופליין'),120)),false,'','');
    insert into public.offline_question_devices(device_key,user_id,display_name,local_username)
    values (p_device_key,v_user_id,left(coalesce(nullif(trim(p_display_name),''),'אורח אופליין'),120),left(nullif(trim(p_local_username),''),120));
  else
    update public.offline_question_devices
    set display_name=left(coalesce(nullif(trim(p_display_name),''),display_name),120),
        local_username=left(coalesce(nullif(trim(p_local_username),''),local_username),120),
        last_seen_at=now()
    where device_key=p_device_key;
    update public.profiles
    set display_name=left(coalesce(nullif(trim(p_display_name),''),display_name),120)
    where id=v_user_id;
  end if;

  insert into public.cards (id,user_id,deck_id,type,question,answer,options,correct_indices,correct_boolean,explanation,tags,srs,stats,masechta,daf,amud,moderation_status,created_at,updated_at)
  values (v_card_id,v_user_id,null,v_type,v_question,nullif(p_card->>'answer',''),coalesce(p_card->'options','null'::jsonb),coalesce(p_card->'correctIndices','null'::jsonb),case when v_type='boolean' then coalesce((p_card->>'correct')::boolean,false) else null end,nullif(p_card->>'explanation',''),coalesce(p_card->'tags','[]'::jsonb)||jsonb_build_array(v_device_tag),coalesce(p_card->'srs','{}'::jsonb),coalesce(p_card->'stats','{}'::jsonb),nullif(p_card->>'masechta',''),nullif(p_card->>'daf','')::integer,nullif(p_card->>'amud','')::integer,'private',coalesce(to_timestamp(nullif(p_card->>'createdAt','')::double precision/1000.0),now()),now())
  on conflict (id) do update
  set user_id=excluded.user_id,
      question=excluded.question,
      answer=excluded.answer,
      options=excluded.options,
      correct_indices=excluded.correct_indices,
      correct_boolean=excluded.correct_boolean,
      explanation=excluded.explanation,
      tags=excluded.tags,
      updated_at=now()
  where public.cards.user_id=v_user_id
     or exists (
       select 1 from jsonb_array_elements_text(coalesce(public.cards.tags,'[]'::jsonb)) t(value)
       where t.value=v_device_tag
     );
  return v_card_id;
end;
$$;
revoke all on function public.submit_offline_question(uuid,text,text,jsonb) from public;
grant execute on function public.submit_offline_question(uuid,text,text,jsonb) to anon, authenticated;

create or replace function public.get_admin_user_questions()
returns setof public.cards
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_source_user_id uuid := public.get_guest_source_user_id();
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return query
  select c.*
  from public.cards c
  where c.deleted_at is null
    and (
      v_source_user_id is null
      or c.user_id <> v_source_user_id
      or exists (
        select 1 from jsonb_array_elements_text(coalesce(c.tags,'[]'::jsonb)) t(value)
        where t.value like 'source:offline-device:%'
      )
    )
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(c.tags,'[]'::jsonb)) t(value)
      where t.value='source:site_library' or t.value like 'source:builtin%'
    )
  order by c.created_at desc;
end;
$$;
revoke all on function public.get_admin_user_questions() from public;
grant execute on function public.get_admin_user_questions() to authenticated;

create or replace function public.publish_user_question(p_card_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.cards%rowtype;
  v_source_user_id uuid := public.get_guest_source_user_id();
  v_published_id uuid;
  v_parent_id uuid := null;
  v_category_id uuid;
  v_category_name text;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if v_source_user_id is null then raise exception 'central library owner is not configured'; end if;

  select * into v_original from public.cards where id=p_card_id and deleted_at is null for update;
  if not found then raise exception 'question not found'; end if;
  if v_original.published_card_id is not null then return v_original.published_card_id; end if;

  -- cat: tags are stored in path order by the question editor. Materialize any
  -- missing nodes in the central category tree so the approved question appears
  -- immediately under the user's chosen classification.
  for v_category_name in
    select distinct on (ord) substr(value,5)
    from jsonb_array_elements_text(coalesce(v_original.tags,'[]'::jsonb)) with ordinality t(value,ord)
    where value like 'cat:%' and length(substr(value,5)) > 0
    order by ord
  loop
    select id into v_category_id
    from public.categories
    where user_id=v_source_user_id
      and name=v_category_name
      and parent_id is not distinct from v_parent_id
      and deleted_at is null
    order by created_at limit 1;
    if v_category_id is null then
      insert into public.categories(user_id,name,parent_id)
      values(v_source_user_id,v_category_name,v_parent_id)
      returning id into v_category_id;
    end if;
    v_parent_id := v_category_id;
    v_category_id := null;
  end loop;

  v_published_id := gen_random_uuid();
  insert into public.cards(id,user_id,deck_id,type,question,answer,options,correct_indices,correct_boolean,explanation,tags,srs,stats,masechta,daf,amud,moderation_status,moderated_at,moderated_by,created_at,updated_at)
  values(v_published_id,v_source_user_id,null,v_original.type,v_original.question,v_original.answer,v_original.options,v_original.correct_indices,v_original.correct_boolean,v_original.explanation,
    (select coalesce(jsonb_agg(value),'[]'::jsonb) from (select distinct value from jsonb_array_elements_text(coalesce(v_original.tags,'[]'::jsonb)||jsonb_build_array('source:site_library','source:user:'||v_original.user_id::text)) t(value)) d),
    '{}'::jsonb,'{"totalReviews":0,"correct":0,"incorrect":0}'::jsonb,v_original.masechta,v_original.daf,v_original.amud,'published',now(),auth.uid(),now(),now());

  update public.cards
  set moderation_status='published',published_card_id=v_published_id,moderated_at=now(),moderated_by=auth.uid(),updated_at=now()
  where id=p_card_id;
  return v_published_id;
end;
$$;
revoke all on function public.publish_user_question(uuid) from public;
grant execute on function public.publish_user_question(uuid) to authenticated;
