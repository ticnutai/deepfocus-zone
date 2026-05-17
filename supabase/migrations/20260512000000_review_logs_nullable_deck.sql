-- review_logs.deck_id: make nullable so category-owned cards (no deck) can still be logged.
-- Previously: deck_id uuid NOT NULL REFERENCES decks ON DELETE CASCADE
-- After:      deck_id uuid NULL REFERENCES decks ON DELETE SET NULL

alter table public.review_logs
  alter column deck_id drop not null,
  drop constraint if exists review_logs_deck_id_fkey;

alter table public.review_logs
  add constraint review_logs_deck_id_fkey
    foreign key (deck_id) references public.decks(id) on delete set null;
