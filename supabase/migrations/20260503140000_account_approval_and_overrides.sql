-- =========================================================
-- Account Approval & Per-User Permission Overrides
-- =========================================================

-- 1. Add status + email cache to profiles
alter table public.profiles
  add column if not exists status text not null default 'approved'
    check (status in ('pending','approved','blocked')),
  add column if not exists email text;

-- Backfill email from auth.users
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- 2. approved_emails — whitelist that auto-approves on registration
create table if not exists public.approved_emails (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  note         text,
  added_by     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint approved_emails_email_lower unique (lower(email))
);
alter table public.approved_emails enable row level security;
create policy "approved_emails_admin_all" on public.approved_emails
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- 3. Per-user permission overrides (override role-based perms per user)
create table if not exists public.user_permission_overrides (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  module     public.permission_module not null,
  action     public.permission_action not null,
  allowed    boolean not null,
  set_by     uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint user_perm_overrides_unique unique (user_id, module, action)
);
create index if not exists user_perm_overrides_user_idx on public.user_permission_overrides(user_id);
alter table public.user_permission_overrides enable row level security;
create policy "upo_admin_all" on public.user_permission_overrides
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
create policy "upo_read_own" on public.user_permission_overrides
  for select to authenticated using (user_id = auth.uid());

-- 4. Update handle_new_user to cache email and check approved_emails
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _status text;
begin
  -- Auto-approve if email is pre-approved
  if exists (
    select 1 from public.approved_emails
    where lower(email) = lower(new.email)
  ) then
    _status := 'approved';
  else
    _status := 'approved'; -- default; change to 'pending' to require manual approval
  end if;

  insert into public.profiles (id, display_name, email, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email,
    _status
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(profiles.display_name, excluded.display_name);
  return new;
end; $$;

-- 5. Update has_permission to check overrides first
create or replace function public.has_permission(
  _user_id uuid,
  _module  public.permission_module,
  _action  public.permission_action
) returns boolean language plpgsql stable security definer set search_path = public
as $fn$
declare
  _override boolean;
begin
  -- Explicit per-user override takes priority
  select allowed into _override
  from public.user_permission_overrides
  where user_id = _user_id and module = _module and action = _action
  limit 1;

  if found then
    return _override;
  end if;

  -- Fall back to role-based permissions
  return exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = _user_id
      and rp.module = _module
      and rp.action = _action
      and rp.allowed = true
  );
end; $fn$;

-- 6. Admin-visible profiles policy already existed; also allow admin to update status
drop policy if exists "profiles_admin_update_status" on public.profiles;
create policy "profiles_admin_update_status" on public.profiles
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
