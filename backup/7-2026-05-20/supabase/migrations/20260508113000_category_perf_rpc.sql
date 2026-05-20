-- Category performance improvements: indexes + RPC helpers for lazy tree loading.

create index if not exists idx_categories_user_parent
  on public.categories (user_id, parent_id);

create index if not exists idx_categories_user_parent_sort
  on public.categories (user_id, parent_id, sort_order, created_at);

create or replace function public.get_category_children(p_parent_id uuid default null)
returns table (
  id uuid,
  name text,
  parent_id uuid,
  color text,
  created_at timestamptz,
  sort_order integer,
  has_children boolean
)
language sql
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.parent_id,
    c.color,
    c.created_at,
    c.sort_order,
    exists (
      select 1
      from public.categories ch
      where ch.user_id = c.user_id
        and ch.parent_id = c.id
    ) as has_children
  from public.categories c
  where c.user_id = auth.uid()
    and (
      (p_parent_id is null and c.parent_id is null)
      or c.parent_id = p_parent_id
    )
  order by c.sort_order nulls last, c.created_at;
$$;

grant execute on function public.get_category_children(uuid) to authenticated;

create or replace function public.reorder_user_categories(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  with ordered as (
    select id, ord::integer - 1 as sort_order
    from unnest(p_ids) with ordinality as t(id, ord)
  )
  update public.categories c
  set sort_order = o.sort_order
  from ordered o
  where c.id = o.id
    and c.user_id = auth.uid();
$$;

grant execute on function public.reorder_user_categories(uuid[]) to authenticated;
