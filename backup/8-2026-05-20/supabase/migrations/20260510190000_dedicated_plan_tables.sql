-- Dedicated tables for general study plans and plan reviews.
-- Keeps per-record timestamps and avoids large JSON blob overwrite races.

create table if not exists public.study_general_plans (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  plan_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_general_plans_user_idx
  on public.study_general_plans(user_id);
create index if not exists study_general_plans_user_updated_idx
  on public.study_general_plans(user_id, plan_updated_at desc);

alter table public.study_general_plans enable row level security;

drop policy if exists "study_general_plans_all_own" on public.study_general_plans;
create policy "study_general_plans_all_own" on public.study_general_plans
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists study_general_plans_touch on public.study_general_plans;
create trigger study_general_plans_touch
  before update on public.study_general_plans
  for each row execute function public.touch_updated_at();

create table if not exists public.study_plan_reviews (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  review_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_plan_reviews_user_idx
  on public.study_plan_reviews(user_id);
create index if not exists study_plan_reviews_user_updated_idx
  on public.study_plan_reviews(user_id, review_updated_at desc);

alter table public.study_plan_reviews enable row level security;

drop policy if exists "study_plan_reviews_all_own" on public.study_plan_reviews;
create policy "study_plan_reviews_all_own" on public.study_plan_reviews
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists study_plan_reviews_touch on public.study_plan_reviews;
create trigger study_plan_reviews_touch
  before update on public.study_plan_reviews
  for each row execute function public.touch_updated_at();

-- Backfill from user_settings JSON blobs (non-destructive).
insert into public.study_general_plans (id, user_id, data, plan_updated_at)
select
  coalesce(plan_item->>'id', gen_random_uuid()::text) as id,
  us.user_id,
  plan_item,
  coalesce(
    to_timestamp(nullif(plan_item->>'updatedAt', '')::double precision / 1000.0),
    to_timestamp(nullif(plan_item->>'createdAt', '')::double precision / 1000.0),
    to_timestamp(nullif(plan_item->>'startDate', '')::double precision / 1000.0),
    now()
  ) as plan_updated_at
from public.user_settings us
cross join lateral jsonb_array_elements(coalesce(us.general_plans, '[]'::jsonb)) as plan_item
on conflict (id) do update
set
  user_id = excluded.user_id,
  data = excluded.data,
  plan_updated_at = excluded.plan_updated_at;

insert into public.study_plan_reviews (id, user_id, data, review_updated_at)
select
  coalesce(review_item->>'id', gen_random_uuid()::text) as id,
  us.user_id,
  review_item,
  coalesce(
    to_timestamp(nullif(review_item->>'updatedAt', '')::double precision / 1000.0),
    to_timestamp(nullif(review_item->>'createdAt', '')::double precision / 1000.0),
    now()
  ) as review_updated_at
from public.user_settings us
cross join lateral jsonb_array_elements(coalesce(us.general_plan_reviews, '[]'::jsonb)) as review_item
on conflict (id) do update
set
  user_id = excluded.user_id,
  data = excluded.data,
  review_updated_at = excluded.review_updated_at;
