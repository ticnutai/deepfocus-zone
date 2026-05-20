-- Fix RLS upsert failures caused by globally unique IDs across users.
-- Make conflicts user-scoped so upserts do not collide with another user's rows.

-- study_general_plans: switch primary key from (id) to (user_id, id)
alter table public.study_general_plans drop constraint if exists study_general_plans_pkey;
alter table public.study_general_plans add constraint study_general_plans_pkey primary key (user_id, id);
create index if not exists study_general_plans_id_idx on public.study_general_plans (id);

-- study_plan_reviews: switch primary key from (id) to (user_id, id)
alter table public.study_plan_reviews drop constraint if exists study_plan_reviews_pkey;
alter table public.study_plan_reviews add constraint study_plan_reviews_pkey primary key (user_id, id);
create index if not exists study_plan_reviews_id_idx on public.study_plan_reviews (id);
