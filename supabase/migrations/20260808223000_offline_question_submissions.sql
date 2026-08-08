-- Upload questions created without a cloud session. Each installation gets a
-- stable, non-login owner so the existing admin questions screen can display it.
create table if not exists public.offline_question_devices (
  device_key uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null,
  local_username text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.offline_question_devices enable row level security;
drop policy if exists "offline_devices_admin_select" on public.offline_question_devices;
create policy "offline_devices_admin_select" on public.offline_question_devices
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.submit_offline_question(p_device_key uuid, p_display_name text, p_local_username text, p_card jsonb)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_user_id uuid; v_email text;
  v_question text := trim(coalesce(p_card->>'question', ''));
  v_type text := coalesce(nullif(p_card->>'type', ''), 'multiple');
  v_card_id uuid;
begin
  if p_device_key is null then raise exception 'device key is required'; end if;
  if length(v_question) < 1 or length(v_question) > 20000 then raise exception 'invalid question'; end if;
  if v_type not in ('flashcard', 'multiple', 'boolean', 'combo') then raise exception 'invalid question type'; end if;
  begin v_card_id := (p_card->>'id')::uuid; exception when others then raise exception 'invalid card id'; end;
  select user_id into v_user_id from public.offline_question_devices where device_key = p_device_key;
  if v_user_id is null then
    v_user_id := gen_random_uuid();
    v_email := 'offline-' || replace(p_device_key::text, '-', '') || '@users.local';
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,confirmation_token,recovery_token)
    values ('00000000-0000-0000-0000-000000000000',v_user_id,'authenticated','authenticated',v_email,extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,jsonb_build_object('display_name',left(coalesce(nullif(trim(p_display_name),''),'אורח אופליין'),120)),false,'','');
    insert into public.offline_question_devices(device_key,user_id,display_name,local_username)
    values (p_device_key,v_user_id,left(coalesce(nullif(trim(p_display_name),''),'אורח אופליין'),120),left(nullif(trim(p_local_username),''),120));
  else
    update public.offline_question_devices set display_name=left(coalesce(nullif(trim(p_display_name),''),display_name),120),local_username=left(coalesce(nullif(trim(p_local_username),''),local_username),120),last_seen_at=now() where device_key=p_device_key;
    update public.profiles set display_name=left(coalesce(nullif(trim(p_display_name),''),display_name),120) where id=v_user_id;
  end if;
  insert into public.cards (id,user_id,deck_id,type,question,answer,options,correct_indices,correct_boolean,explanation,tags,srs,stats,masechta,daf,amud,moderation_status,created_at,updated_at)
  values (v_card_id,v_user_id,null,v_type,v_question,nullif(p_card->>'answer',''),coalesce(p_card->'options','null'::jsonb),coalesce(p_card->'correctIndices','null'::jsonb),case when v_type='boolean' then coalesce((p_card->>'correct')::boolean,false) else null end,nullif(p_card->>'explanation',''),coalesce(p_card->'tags','[]'::jsonb)||jsonb_build_array('source:offline-device:'||p_device_key::text),coalesce(p_card->'srs','{}'::jsonb),coalesce(p_card->'stats','{}'::jsonb),nullif(p_card->>'masechta',''),nullif(p_card->>'daf','')::integer,nullif(p_card->>'amud','')::integer,'private',coalesce(to_timestamp(nullif(p_card->>'createdAt','')::double precision/1000.0),now()),now())
  on conflict (id) do update set question=excluded.question,answer=excluded.answer,options=excluded.options,correct_indices=excluded.correct_indices,correct_boolean=excluded.correct_boolean,explanation=excluded.explanation,tags=excluded.tags,updated_at=now()
  where public.cards.user_id=v_user_id;
  return v_card_id;
end; $$;
revoke all on function public.submit_offline_question(uuid,text,text,jsonb) from public;
grant execute on function public.submit_offline_question(uuid,text,text,jsonb) to anon, authenticated;
