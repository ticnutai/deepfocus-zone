-- =========== Profiles ===========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- timestamp helper
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========== Decks ===========
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  color text not null default 'gold',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index decks_user_idx on public.decks(user_id);
alter table public.decks enable row level security;
create policy "decks_all_own" on public.decks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger decks_touch before update on public.decks
  for each row execute function public.touch_updated_at();

-- =========== Cards ===========
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references public.decks(id) on delete cascade,
  type text not null check (type in ('flashcard','multiple','boolean','combo')),
  question text not null,
  answer text,
  options jsonb,
  correct_indices jsonb,
  correct_boolean boolean,
  explanation text,
  tags jsonb not null default '[]'::jsonb,
  srs jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{"totalReviews":0,"correct":0,"incorrect":0}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cards_user_idx on public.cards(user_id);
create index cards_deck_idx on public.cards(deck_id);
alter table public.cards enable row level security;
create policy "cards_all_own" on public.cards
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger cards_touch before update on public.cards
  for each row execute function public.touch_updated_at();

-- =========== Review Logs ===========
create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  deck_id uuid not null references public.decks(id) on delete cascade,
  at timestamptz not null default now(),
  quality smallint not null check (quality between 0 and 5),
  correct boolean not null,
  duration_ms integer not null default 0
);
create index review_logs_user_idx on public.review_logs(user_id);
create index review_logs_card_idx on public.review_logs(card_id);
create index review_logs_at_idx on public.review_logs(at desc);
alter table public.review_logs enable row level security;
create policy "review_logs_all_own" on public.review_logs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========== Categories ===========
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories(id) on delete cascade,
  color text,
  created_at timestamptz not null default now()
);
create index categories_user_idx on public.categories(user_id);
alter table public.categories enable row level security;
create policy "categories_all_own" on public.categories
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========== Goals ===========
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  target numeric not null default 0,
  window_days integer,
  deck_id uuid references public.decks(id) on delete set null,
  active boolean not null default true,
  manual_done_dates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_idx on public.goals(user_id);
alter table public.goals enable row level security;
create policy "goals_all_own" on public.goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger goals_touch before update on public.goals
  for each row execute function public.touch_updated_at();

-- =========== Shas Plan ===========
create table public.shas_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  selected_masechtos jsonb not null default '[]'::jsonb,
  pages_per_day integer not null default 1,
  start_date timestamptz not null default now(),
  current_masechta text not null,
  current_daf integer not null default 2,
  completed jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shas_plans enable row level security;
create policy "shas_plans_all_own" on public.shas_plans
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger shas_plans_touch before update on public.shas_plans
  for each row execute function public.touch_updated_at();

-- =========== Day Notes ===========
create table public.day_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  text text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);
create index day_notes_user_idx on public.day_notes(user_id);
alter table public.day_notes enable row level security;
create policy "day_notes_all_own" on public.day_notes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger day_notes_touch before update on public.day_notes
  for each row execute function public.touch_updated_at();

-- =========== User Settings ===========
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notifications_enabled boolean not null default false,
  reminder_time text not null default '20:00',
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "user_settings_all_own" on public.user_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- =========== Achievements ===========
create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  unlocked_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  unique (user_id, code)
);
create index achievements_user_idx on public.achievements(user_id);
alter table public.achievements enable row level security;
create policy "achievements_select_own" on public.achievements
  for select to authenticated using (user_id = auth.uid());
create policy "achievements_insert_own" on public.achievements
  for insert to authenticated with check (user_id = auth.uid());