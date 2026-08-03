-- Admin moderation for user-created questions.
-- Regular users keep access only to their own rows; the additional policies
-- below are restricted by public.is_admin(auth.uid()).

alter table public.cards
  add column if not exists moderation_status text not null default 'private',
  add column if not exists moderation_note text,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null,
  add column if not exists published_card_id uuid references public.cards(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cards_moderation_status_check'
  ) then
    alter table public.cards add constraint cards_moderation_status_check
      check (moderation_status in ('private', 'reviewed', 'hidden', 'published'));
  end if;
end $$;

create index if not exists cards_moderation_status_idx
  on public.cards (moderation_status, created_at desc)
  where deleted_at is null;

drop policy if exists "cards_admin_select_all" on public.cards;
create policy "cards_admin_select_all" on public.cards
  for select to authenticated using (public.is_admin(auth.uid()));

drop policy if exists "cards_admin_update_all" on public.cards;
create policy "cards_admin_update_all" on public.cards
  for update to authenticated using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "cards_admin_insert_all" on public.cards;
create policy "cards_admin_insert_all" on public.cards
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists "cards_admin_delete_all" on public.cards;
create policy "cards_admin_delete_all" on public.cards
  for delete to authenticated using (public.is_admin(auth.uid()));

comment on column public.cards.moderation_status is
  'private=user owned, reviewed=admin checked, hidden=hidden in moderation, published=copied to site source';
