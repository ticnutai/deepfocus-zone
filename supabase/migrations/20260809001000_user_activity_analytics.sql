-- Reliable login and active-time analytics for authenticated cloud users.
create table if not exists public.user_activity_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  login_count integer not null default 0 check (login_count >= 0),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_login_at timestamptz,
  primary key (user_id, activity_date)
);

create index if not exists user_activity_daily_date_idx
  on public.user_activity_daily (activity_date desc);

alter table public.user_activity_daily enable row level security;

drop policy if exists "users_read_own_activity" on public.user_activity_daily;
create policy "users_read_own_activity" on public.user_activity_daily
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "admins_read_all_activity" on public.user_activity_daily;
create policy "admins_read_all_activity" on public.user_activity_daily
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.record_user_activity(
  p_event text default 'heartbeat',
  p_active_seconds integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_day date := timezone('Asia/Jerusalem', now())::date;
  v_seconds integer := greatest(0, least(coalesce(p_active_seconds, 0), 300));
  v_login integer := case when p_event = 'login' then 1 else 0 end;
begin
  if v_user_id is null then return; end if;

  insert into public.user_activity_daily (
    user_id, activity_date, login_count, active_seconds,
    first_seen_at, last_seen_at, last_login_at
  ) values (
    v_user_id, v_day, v_login, v_seconds,
    now(), now(), case when v_login = 1 then now() else null end
  )
  on conflict (user_id, activity_date) do update set
    login_count = public.user_activity_daily.login_count + excluded.login_count,
    active_seconds = public.user_activity_daily.active_seconds + excluded.active_seconds,
    last_seen_at = now(),
    last_login_at = case
      when excluded.last_login_at is not null then excluded.last_login_at
      else public.user_activity_daily.last_login_at
    end;
end;
$$;

revoke all on function public.record_user_activity(text, integer) from public;
grant execute on function public.record_user_activity(text, integer) to authenticated;

-- Give existing cloud accounts a useful historical starting point.
insert into public.user_activity_daily (
  user_id, activity_date, login_count, active_seconds,
  first_seen_at, last_seen_at, last_login_at
)
select
  u.id,
  timezone('Asia/Jerusalem', u.last_sign_in_at)::date,
  1,
  0,
  u.last_sign_in_at,
  u.last_sign_in_at,
  u.last_sign_in_at
from auth.users u
join public.profiles p on p.id = u.id
where u.last_sign_in_at is not null
on conflict (user_id, activity_date) do nothing;
