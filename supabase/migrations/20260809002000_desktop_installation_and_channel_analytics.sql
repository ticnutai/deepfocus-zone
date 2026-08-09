alter table public.user_activity_daily
  add column if not exists web_login_count integer not null default 0,
  add column if not exists desktop_login_count integer not null default 0,
  add column if not exists web_active_seconds integer not null default 0,
  add column if not exists desktop_active_seconds integer not null default 0;

drop function if exists public.record_user_activity(text, integer);
create function public.record_user_activity(p_event text default 'heartbeat', p_active_seconds integer default 0, p_client_type text default 'web')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_day date := timezone('Asia/Jerusalem', now())::date;
  v_seconds integer := greatest(0, least(coalesce(p_active_seconds, 0), 300));
  v_login integer := case when p_event = 'login' then 1 else 0 end;
  v_client text := case when p_client_type = 'desktop' then 'desktop' else 'web' end;
begin
  if v_user_id is null then return; end if;
  insert into public.user_activity_daily (user_id, activity_date, login_count, active_seconds, first_seen_at, last_seen_at, last_login_at, web_login_count, desktop_login_count, web_active_seconds, desktop_active_seconds)
  values (v_user_id, v_day, v_login, v_seconds, now(), now(), case when v_login = 1 then now() else null end,
    case when v_client = 'web' then v_login else 0 end, case when v_client = 'desktop' then v_login else 0 end,
    case when v_client = 'web' then v_seconds else 0 end, case when v_client = 'desktop' then v_seconds else 0 end)
  on conflict (user_id, activity_date) do update set
    login_count = public.user_activity_daily.login_count + excluded.login_count,
    active_seconds = public.user_activity_daily.active_seconds + excluded.active_seconds,
    web_login_count = public.user_activity_daily.web_login_count + excluded.web_login_count,
    desktop_login_count = public.user_activity_daily.desktop_login_count + excluded.desktop_login_count,
    web_active_seconds = public.user_activity_daily.web_active_seconds + excluded.web_active_seconds,
    desktop_active_seconds = public.user_activity_daily.desktop_active_seconds + excluded.desktop_active_seconds,
    last_seen_at = now(),
    last_login_at = case when excluded.last_login_at is not null then excluded.last_login_at else public.user_activity_daily.last_login_at end;
end; $$;
revoke all on function public.record_user_activity(text, integer, text) from public;
grant execute on function public.record_user_activity(text, integer, text) to authenticated;

create table if not exists public.desktop_install_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('install', 'update')),
  from_version text,
  to_version text not null,
  install_id text not null,
  occurred_at timestamptz not null,
  reported_at timestamptz not null default now(),
  unique (user_id, event_type, to_version, install_id)
);
create index if not exists desktop_install_events_occurred_idx on public.desktop_install_events (occurred_at desc);
alter table public.desktop_install_events enable row level security;
drop policy if exists "admins_read_desktop_install_events" on public.desktop_install_events;
create policy "admins_read_desktop_install_events" on public.desktop_install_events for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.record_desktop_install_event(p_event_type text, p_from_version text, p_to_version text, p_install_id text, p_occurred_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_event_type not in ('install', 'update') then raise exception 'invalid event type'; end if;
  insert into public.desktop_install_events(user_id, event_type, from_version, to_version, install_id, occurred_at)
  values (auth.uid(), p_event_type, nullif(p_from_version, ''), p_to_version, p_install_id, p_occurred_at)
  on conflict (user_id, event_type, to_version, install_id) do nothing;
end; $$;
revoke all on function public.record_desktop_install_event(text, text, text, text, timestamptz) from public;
grant execute on function public.record_desktop_install_event(text, text, text, text, timestamptz) to authenticated;
