-- User cloud backups table
-- Stores named backup snapshots per user for cloud-based restore

create table if not exists user_backups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  size_bytes  integer not null default 0,
  topic_ids   text[] default '{}',     -- category/deck ids that were selected (empty = full backup)
  snapshot    jsonb not null
);

-- Only the owner can read/write their own backups
alter table user_backups enable row level security;

create policy "Users can manage own backups"
  on user_backups for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for fast listing
create index user_backups_user_created on user_backups(user_id, created_at desc);
