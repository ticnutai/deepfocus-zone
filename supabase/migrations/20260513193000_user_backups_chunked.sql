-- Cloud backups chunk storage to avoid large REST payload failures
-- Adds chunked mode with resumable uploads

alter table if exists public.user_backups
  add column if not exists storage_mode text not null default 'inline',
  add column if not exists total_chunks integer not null default 0;

alter table if exists public.user_backups
  drop constraint if exists user_backups_storage_mode_check;

alter table if exists public.user_backups
  add constraint user_backups_storage_mode_check
  check (storage_mode in ('inline', 'chunked'));

create table if not exists public.user_backup_chunks (
  backup_id uuid not null references public.user_backups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_data text not null,
  created_at timestamptz not null default now(),
  primary key (backup_id, chunk_index)
);

alter table public.user_backup_chunks enable row level security;

drop policy if exists "Users can manage own backup chunks" on public.user_backup_chunks;
create policy "Users can manage own backup chunks"
  on public.user_backup_chunks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists user_backup_chunks_user_backup_idx
  on public.user_backup_chunks(user_id, backup_id, chunk_index);
