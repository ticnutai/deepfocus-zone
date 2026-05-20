-- Universal updated_at support for LWW sync.
-- Adds updated_at to core study tables and ensures it is bumped on every UPDATE.

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.decks') is not null then
    alter table public.decks add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.cards') is not null then
    alter table public.cards add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.review_logs') is not null then
    alter table public.review_logs add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.categories') is not null then
    alter table public.categories add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.goals') is not null then
    alter table public.goals add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.learning_sessions') is not null then
    alter table public.learning_sessions add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.day_notes') is not null then
    alter table public.day_notes add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.card_decks') is not null then
    alter table public.card_decks add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.shas_reviews') is not null then
    alter table public.shas_reviews add column if not exists updated_at timestamptz not null default now();
  end if;
end $$;

-- Drop old *_touch triggers (created by earlier migrations) before replacing with canonical trg_* ones.
drop trigger if exists decks_touch on public.decks;
drop trigger if exists cards_touch on public.cards;
drop trigger if exists goals_touch on public.goals;
drop trigger if exists day_notes_touch on public.day_notes;
drop trigger if exists learning_sessions_touch on public.learning_sessions;
drop trigger if exists trg_shas_reviews_touch on public.shas_reviews;

do $$
begin
  if to_regclass('public.decks') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_decks_set_updated_at'
  ) then
    create trigger trg_decks_set_updated_at
    before update on public.decks
    for each row execute function public.set_row_updated_at();
  end if;

  if to_regclass('public.cards') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_cards_set_updated_at'
  ) then
    create trigger trg_cards_set_updated_at
    before update on public.cards
    for each row execute function public.set_row_updated_at();
  end if;

  if to_regclass('public.review_logs') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_review_logs_set_updated_at'
  ) then
    create trigger trg_review_logs_set_updated_at
    before update on public.review_logs
    for each row execute function public.set_row_updated_at();
  end if;

  if to_regclass('public.categories') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_categories_set_updated_at'
  ) then
    create trigger trg_categories_set_updated_at
    before update on public.categories
    for each row execute function public.set_row_updated_at();
  end if;

  if to_regclass('public.goals') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_goals_set_updated_at'
  ) then
    create trigger trg_goals_set_updated_at
    before update on public.goals
    for each row execute function public.set_row_updated_at();
  end if;

  if to_regclass('public.learning_sessions') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_learning_sessions_set_updated_at'
  ) then
    create trigger trg_learning_sessions_set_updated_at
    before update on public.learning_sessions
    for each row execute function public.set_row_updated_at();
  end if;

  if to_regclass('public.day_notes') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_day_notes_set_updated_at'
  ) then
    create trigger trg_day_notes_set_updated_at
    before update on public.day_notes
    for each row execute function public.set_row_updated_at();
  end if;

  if to_regclass('public.card_decks') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_card_decks_set_updated_at'
  ) then
    create trigger trg_card_decks_set_updated_at
    before update on public.card_decks
    for each row execute function public.set_row_updated_at();
  end if;

  if to_regclass('public.shas_reviews') is not null and not exists (
    select 1 from pg_trigger where tgname = 'trg_shas_reviews_set_updated_at'
  ) then
    create trigger trg_shas_reviews_set_updated_at
    before update on public.shas_reviews
    for each row execute function public.set_row_updated_at();
  end if;
end $$;
