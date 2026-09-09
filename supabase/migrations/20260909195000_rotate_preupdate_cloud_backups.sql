-- Keep a small rotating set of automatic pre-update backups per user.
-- The RPC is security-invoker, so the existing user_backups RLS policy remains
-- the authority for which rows the caller may remove.
create or replace function public.prune_preupdate_backups(p_keep integer default 2)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_keep integer := greatest(1, least(coalesce(p_keep, 2), 20));
  v_deleted integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  with ranked as (
    select
      id,
      row_number() over (order by created_at desc, id desc) as position
    from public.user_backups
    where user_id = v_user_id
      and (
        topic_ids @> array['system:pre-update']::text[]
        or name like 'גיבוי אוטומטי לפני עדכון%'
      )
  ), removed as (
    delete from public.user_backups as backup
    using ranked
    where backup.id = ranked.id
      and backup.user_id = v_user_id
      and ranked.position > v_keep
    returning backup.id
  )
  select count(*)::integer into v_deleted from removed;

  return v_deleted;
end;
$$;

revoke all on function public.prune_preupdate_backups(integer) from public, anon;
grant execute on function public.prune_preupdate_backups(integer) to authenticated;
