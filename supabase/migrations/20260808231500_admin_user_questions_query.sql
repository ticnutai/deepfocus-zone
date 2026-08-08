-- Return only user-created questions to admins. Keeping this filtering in the
-- database avoids downloading the full bundled question library first.
-- The existing library was imported under the original admin account; record
-- that largest library owner as the read-only site source used by guest mode.
update public.site_settings
set value = jsonb_build_object(
  'enabled', true,
  'user_id', (
    select user_id
    from public.cards
    where deleted_at is null
    group by user_id
    order by count(*) desc
    limit 1
  )
)
where key = 'guest_source'
  and exists (select 1 from public.cards where deleted_at is null);

create or replace function public.get_admin_user_questions()
returns setof public.cards
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source_user_id uuid := public.get_guest_source_user_id();
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  return query
  select c.*
  from public.cards c
  where c.deleted_at is null
    and (v_source_user_id is null or c.user_id <> v_source_user_id)
    and not exists (
      select 1
      from jsonb_array_elements_text(coalesce(c.tags, '[]'::jsonb)) tag(value)
      where tag.value = 'source:site_library'
         or tag.value like 'source:builtin%'
    )
  order by c.created_at desc;
end;
$$;

revoke all on function public.get_admin_user_questions() from public;
grant execute on function public.get_admin_user_questions() to authenticated;
