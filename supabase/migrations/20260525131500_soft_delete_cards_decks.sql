-- Add soft-delete support for decks and cards so cross-device sync can
-- resolve deletes by latest timestamp (LWW) instead of hard-delete races.

alter table public.decks
  add column if not exists deleted_at timestamptz;

alter table public.cards
  add column if not exists deleted_at timestamptz;

create index if not exists decks_user_deleted_at_idx
  on public.decks (user_id, deleted_at);

create index if not exists cards_user_deleted_at_idx
  on public.cards (user_id, deleted_at);

create index if not exists decks_deleted_at_idx
  on public.decks (deleted_at);

create index if not exists cards_deleted_at_idx
  on public.cards (deleted_at);
