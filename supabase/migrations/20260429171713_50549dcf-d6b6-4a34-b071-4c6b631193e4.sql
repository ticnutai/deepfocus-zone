create type public.permission_module as enum ('decks','cards','goals','shas','analytics','users','roles','settings');
create type public.permission_action as enum ('view','create','edit','delete','manage');

create table public.app_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_roles enable row level security;
create trigger app_roles_touch before update on public.app_roles
  for each row execute function public.touch_updated_at();

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.app_roles(id) on delete cascade,
  module public.permission_module not null,
  action public.permission_action not null,
  allowed boolean not null default false,
  unique (role_id, module, action)
);
alter table public.role_permissions enable row level security;
create index role_permissions_role_idx on public.role_permissions(role_id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.app_roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  unique (user_id, role_id)
);
alter table public.user_roles enable row level security;
create index user_roles_user_idx on public.user_roles(user_id);

create or replace function public.has_permission(_user_id uuid, _module public.permission_module, _action public.permission_action)
returns boolean language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = _user_id and rp.module = _module and rp.action = _action and rp.allowed = true
  );
$fn$;

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $fn$
  select exists (
    select 1 from public.user_roles ur
    join public.app_roles r on r.id = ur.role_id
    where ur.user_id = _user_id and r.name = 'admin'
  );
$fn$;

revoke all on function public.has_permission(uuid, public.permission_module, public.permission_action) from public, anon;
revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.has_permission(uuid, public.permission_module, public.permission_action) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

create policy "roles_read_all_authenticated" on public.app_roles
  for select to authenticated using (true);
create policy "roles_admin_insert" on public.app_roles
  for insert to authenticated with check (public.is_admin(auth.uid()));
create policy "roles_admin_update" on public.app_roles
  for update to authenticated using (public.is_admin(auth.uid()));
create policy "roles_admin_delete" on public.app_roles
  for delete to authenticated using (public.is_admin(auth.uid()) and is_system = false);

create policy "perms_read_authenticated" on public.role_permissions
  for select to authenticated using (true);
create policy "perms_admin_all" on public.role_permissions
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "user_roles_read_own_or_admin" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.is_admin(auth.uid()));
create policy "user_roles_admin_insert" on public.user_roles
  for insert to authenticated with check (public.is_admin(auth.uid()));
create policy "user_roles_admin_delete" on public.user_roles
  for delete to authenticated using (public.is_admin(auth.uid()));

create policy "profiles_admin_select_all" on public.profiles
  for select to authenticated using (public.is_admin(auth.uid()));

insert into public.app_roles (name, description, is_system) values
  ('admin', 'מנהל מערכת — גישה מלאה', true),
  ('moderator', 'משתמש מתקדם — צפייה ועריכה', true),
  ('user', 'משתמש רגיל — נתונים אישיים', true);

do $seed$
declare
  admin_id uuid := (select id from public.app_roles where name='admin');
  mod_id uuid := (select id from public.app_roles where name='moderator');
  user_id uuid := (select id from public.app_roles where name='user');
  m public.permission_module;
  a public.permission_action;
begin
  for m in select unnest(enum_range(null::public.permission_module)) loop
    for a in select unnest(enum_range(null::public.permission_action)) loop
      insert into public.role_permissions(role_id, module, action, allowed) values (admin_id, m, a, true);
      insert into public.role_permissions(role_id, module, action, allowed) values (
        mod_id, m, a,
        case when m in ('users','roles') then false
             when a in ('view','create','edit') then true
             else false end
      );
      insert into public.role_permissions(role_id, module, action, allowed) values (
        user_id, m, a,
        case when m in ('decks','cards','goals','shas','analytics','settings') and a in ('view','create','edit','delete') then true
             else false end
      );
    end loop;
  end loop;
end $seed$;

create or replace function public.assign_default_role()
returns trigger language plpgsql security definer set search_path = public
as $fn$
declare
  default_role_id uuid;
  is_first boolean;
begin
  select id into default_role_id from public.app_roles where name = 'user' limit 1;
  select count(*) = 0 into is_first from public.user_roles;
  if default_role_id is not null then
    insert into public.user_roles(user_id, role_id) values (new.id, default_role_id) on conflict do nothing;
  end if;
  if is_first then
    insert into public.user_roles(user_id, role_id)
      select new.id, id from public.app_roles where name = 'admin' on conflict do nothing;
  end if;
  return new;
end;
$fn$;

revoke all on function public.assign_default_role() from public, anon, authenticated;

create trigger on_auth_user_assign_role
  after insert on auth.users
  for each row execute function public.assign_default_role();

-- backfill: existing users → user role; first user also admin
do $back$
declare u record; user_role uuid; admin_role uuid; first_user uuid;
begin
  select id into user_role from public.app_roles where name='user';
  select id into admin_role from public.app_roles where name='admin';
  select id into first_user from auth.users order by created_at asc limit 1;
  for u in select id from auth.users loop
    insert into public.user_roles(user_id, role_id) values (u.id, user_role) on conflict do nothing;
  end loop;
  if first_user is not null then
    insert into public.user_roles(user_id, role_id) values (first_user, admin_role) on conflict do nothing;
  end if;
end $back$;